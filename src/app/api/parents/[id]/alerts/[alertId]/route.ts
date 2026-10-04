import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireParentAccess } from '@/lib/access';
import { markHandled, recordOutcome } from '@/lib/escalation';

type Ctx = { params: Promise<{ id: string; alertId: string }> };

const OUTCOMES = ['fine', 'doctor_visit', 'hospital', 'other'] as const;

/**
 * Anyone in the family circle (viewers too: in an emergency whoever can act should be able to say so):
 *   { action: 'on_it' }                                   "I'm on it": stops the escalation calls, tells the others
 *   { action: 'outcome', outcome, note? }                 what happened afterwards; closes the alert
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id, alertId } = await params;
  const access = await requireParentAccess(id, 'view');
  if (!access.ok) return access.response;

  const body = await req.json().catch(() => ({}));
  const alert = await prisma.alertRecord.findFirst({ where: { id: alertId, parentId: id } });
  if (!alert) return NextResponse.json({ error: 'Alert not found' }, { status: 404 });

  if (body.action === 'on_it') {
    const esc = await prisma.escalation.findUnique({ where: { alertId } });
    if (esc) {
      const res = await markHandled(esc.id, { name: access.user.name, phone: access.user.phone || null, via: 'dashboard', userId: access.user.id });
      return NextResponse.json({
        success: true,
        message: res.handled
          ? 'Thanks. We stopped calling the other contacts and told your family you are handling it.'
          : `${res.handledByName || 'Someone'} is already handling this.`
      });
    }
    await prisma.alertRecord.updateMany({
      where: { id: alertId, acknowledgedAt: null },
      data: { acknowledgedAt: new Date(), status: 'resolved', handledByName: access.user.name, handledVia: 'dashboard' }
    });
    return NextResponse.json({ success: true, message: 'Marked as handled.' });
  }

  if (body.action === 'outcome') {
    if (!OUTCOMES.includes(body.outcome)) return NextResponse.json({ error: 'Choose what happened.' }, { status: 400 });
    const note = typeof body.note === 'string' ? body.note.trim() : null;
    const ok = await recordOutcome({
      alertId,
      parentId: id,
      outcome: body.outcome,
      note,
      userId: access.user.id,
      userName: access.user.name
    });
    if (!ok) return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    return NextResponse.json({ success: true, message: 'Thanks. This alert is closed.' });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
