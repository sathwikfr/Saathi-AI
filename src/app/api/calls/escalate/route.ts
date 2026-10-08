import { NextResponse } from 'next/server';
import { raiseToolEscalation } from '@/lib/callResults';
import { requestSecret, routeSecret, safeEqual } from '@/lib/secrets';

/**
 * Called by the Sarvam agent's "escalate_emergency" API tool mid-call when the
 * parent describes an emergency. Configure the tool with bearer auth using
 * SARVAM_WEBHOOK_SECRET. The JSON reply is read back to the agent.
 */
export async function POST(req: Request) {
  if (!safeEqual(requestSecret(req, 'x-sarvam-secret'), routeSecret('SARVAM_ESCALATE_SECRET'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { call_log_id?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const callLogId = typeof body.call_log_id === 'string' ? body.call_log_id : '';
  const reason = typeof body.reason === 'string' ? body.reason : '';
  if (!callLogId) {
    return NextResponse.json({ error: 'call_log_id is required' }, { status: 400 });
  }

  try {
    const result = await raiseToolEscalation(callLogId, reason);
    if (result.status === 'unknown_call') {
      return NextResponse.json({ error: 'Unknown call' }, { status: 404 });
    }
    return NextResponse.json({
      success: true,
      status: result.status,
      message: "The family has been notified and will contact you shortly. Please stay calm and don't hang up until someone reaches you."
    });
  } catch (err) {
    console.error('[escalate] Failed:', err);
    return NextResponse.json({ error: 'Escalation failed' }, { status: 500 });
  }
}
