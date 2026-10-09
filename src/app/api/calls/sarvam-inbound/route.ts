import { NextResponse } from 'next/server';
import { processInboundCall } from '@/lib/callResults';
import { routeSecret, safeEqual } from '@/lib/secrets';

// Alert steps (family messages, the first round of emergency calls) run inside this request: give them the same
// 60 s as the cron rather than the platform default (as low as 10 s), and the cron's stalled-emergency check
// finishes anything a cut-off run left undone.
export const maxDuration = 60;

/**
 * End-of-call webhook of Sarvam's INBOUND deployment: the parent rang Saathi's
 * number back (e.g. after missing a call). Configure the deployment's webhook as
 * https://<domain>/api/calls/sarvam-inbound?token=SARVAM_INBOUND_WEBHOOK_SECRET (falls back to SARVAM_WEBHOOK_SECRET
 * when unset). Set its own secret: the shared one sits in the URL of every outbound call, and anyone holding it
 * could otherwise post a made-up call-back for any parent's number.
 * Payload: interaction_id, user_phone_number, duration, final/output_agent_variables,
 * interaction_transcript (docs/sarvam-agent.md §10). Idempotent per interaction.
 */
export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get('token');
  if (!safeEqual(token, routeSecret('SARVAM_INBOUND_WEBHOOK_SECRET'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!payload || typeof payload !== 'object') return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });

  try {
    const outcome = await processInboundCall(payload as Record<string, unknown>);
    if (outcome.status === 'invalid') return NextResponse.json({ error: outcome.reason }, { status: 400 });
    // A caller we don't know (not a parent): nothing to record. 200 so it isn't retried.
    if (outcome.status === 'unknown_attempt') return NextResponse.json({ success: true, recorded: false });
    return NextResponse.json({ success: true, ...outcome });
  } catch (err) {
    console.error('[sarvam-inbound] Processing failed:', err);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
