import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { newId } from '@/lib/db';
import { requireParentAccess } from '@/lib/access';
import { canTrackReadings, readingsRequired } from '@/lib/planAccess';
import { parseBp, parseSugar } from '@/lib/readings';

type Ctx = { params: Promise<{ id: string }> };

/** BP / sugar readings: said on calls, or typed in by the family from a home machine. */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireParentAccess(id, 'view');
  if (!access.ok) return access.response;
  const days = Math.min(365, Math.max(7, parseInt(new URL(req.url).searchParams.get('days') || '90', 10) || 90));
  const readings = await prisma.healthReading.findMany({
    where: { parentId: id, takenAt: { gte: new Date(Date.now() - days * 86400000) } },
    orderBy: { takenAt: 'asc' }
  });
  return NextResponse.json({
    readings: readings.map(r => ({
      id: r.id, kind: r.kind, systolic: r.systolic, diastolic: r.diastolic, value: r.value, context: r.context,
      takenAt: r.takenAt.toISOString(), source: r.source
    }))
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireParentAccess(id, 'manage');
  if (!access.ok) return access.response;
  // Family / Extended feature (lib/plans.ts `premium`).
  if (!(await canTrackReadings(access.parent.userId))) return readingsRequired();
  const body = await req.json().catch(() => ({}));
  const takenAt = body.takenAt ? new Date(body.takenAt) : new Date();
  if (Number.isNaN(takenAt.getTime()) || takenAt.getTime() > Date.now() + 3600000) {
    return NextResponse.json({ error: 'Please choose when it was taken.' }, { status: 400 });
  }
  if (body.kind === 'bp') {
    const bp = parseBp(`${body.systolic}/${body.diastolic}`);
    if (!bp) return NextResponse.json({ error: 'Enter both numbers, e.g. 130 and 85.' }, { status: 400 });
    await prisma.healthReading.create({
      data: { id: newId('rdg'), parentId: id, kind: 'bp', systolic: bp.systolic, diastolic: bp.diastolic, takenAt, source: 'family', enteredById: access.user.id }
    });
  } else if (body.kind === 'sugar') {
    const sugar = parseSugar(String(body.value ?? ''), body.context);
    if (!sugar) return NextResponse.json({ error: 'Enter the sugar reading in mg/dL, e.g. 120.' }, { status: 400 });
    await prisma.healthReading.create({
      data: { id: newId('rdg'), parentId: id, kind: 'sugar', value: sugar.value, context: sugar.context, takenAt, source: 'family', enteredById: access.user.id }
    });
  } else {
    return NextResponse.json({ error: 'Choose BP or sugar.' }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}

/** Only readings the family typed in can be removed (call readings stay as said). */
export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireParentAccess(id, 'manage');
  if (!access.ok) return access.response;
  const readingId = new URL(req.url).searchParams.get('readingId') || '';
  const res = await prisma.healthReading.deleteMany({ where: { id: readingId, parentId: id, source: 'family' } });
  return NextResponse.json({ success: res.count === 1 });
}
