import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { newId } from '@/lib/db';
import { requireParentAccess } from '@/lib/access';

type Ctx = { params: Promise<{ id: string }> };

const KINDS = ['doctor', 'lab', 'other'];
const MAX_UPCOMING_APPOINTMENTS = 20;

function toJson(a: Awaited<ReturnType<typeof prisma.appointment.findMany>>[number]) {
  return {
    id: a.id, title: a.title, kind: a.kind, startsAt: a.startsAt.toISOString(), location: a.location, notes: a.notes, fasting: a.fasting,
    remindedDayBefore: a.remindedDayBefore?.toISOString(), remindedSameDay: a.remindedSameDay?.toISOString(),
    followedUpAt: a.followedUpAt?.toISOString(), outcomeText: a.outcomeText, cancelledAt: a.cancelledAt?.toISOString()
  };
}

/** Doctor visits and lab tests: Saathi reminds the day before and on the day, then asks how it went. */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireParentAccess(id, 'view');
  if (!access.ok) return access.response;
  const rows = await prisma.appointment.findMany({
    where: { parentId: id, startsAt: { gte: new Date(Date.now() - 60 * 86400000) } },
    orderBy: { startsAt: 'asc' }
  });
  return NextResponse.json({ appointments: rows.map(toJson) });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireParentAccess(id, 'manage');
  if (!access.ok) return access.response;
  const b = await req.json().catch(() => ({}));
  const title = typeof b.title === 'string' ? b.title.trim().slice(0, 100) : '';
  const startsAt = new Date(b.startsAt);
  if (!title) return NextResponse.json({ error: 'What is it for? e.g. "eye check-up".' }, { status: 400 });
  if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() < Date.now() - 3600000) {
    return NextResponse.json({ error: 'Choose a date and time that has not passed.' }, { status: 400 });
  }
  // Each one is up to two reminder messages: keep the list to what a family really plans.
  const upcoming = await prisma.appointment.count({ where: { parentId: id, cancelledAt: null, startsAt: { gte: new Date() } } });
  if (upcoming >= MAX_UPCOMING_APPOINTMENTS) {
    return NextResponse.json({ error: `Up to ${MAX_UPCOMING_APPOINTMENTS} upcoming appointments. Cancel one you no longer need first.` }, { status: 400 });
  }
  const a = await prisma.appointment.create({
    data: {
      id: newId('appt'),
      parentId: id,
      createdById: access.user.id,
      title,
      kind: KINDS.includes(b.kind) ? b.kind : 'doctor',
      startsAt,
      location: typeof b.location === 'string' && b.location.trim() ? b.location.trim().slice(0, 120) : null,
      notes: typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim().slice(0, 200) : null,
      fasting: b.fasting === true
    }
  });
  return NextResponse.json({ success: true, appointment: toJson(a), message: access.parent.reminderChannel === 'whatsapp' ? `We'll message ${access.parent.name} on WhatsApp the evening before and the morning of.` : `Saathi will remind ${access.parent.name} the day before and on the day.` });
}

/** Cancel ({ id, cancel: true }). */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireParentAccess(id, 'manage');
  if (!access.ok) return access.response;
  const b = await req.json().catch(() => ({}));
  if (typeof b.id !== 'string' || b.cancel !== true) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const res = await prisma.appointment.updateMany({ where: { id: b.id, parentId: id, cancelledAt: null }, data: { cancelledAt: new Date() } });
  return NextResponse.json({ success: res.count === 1 });
}
