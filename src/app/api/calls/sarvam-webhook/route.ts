import { NextResponse } from 'next/server';
import { processSarvamWebhook } from '@/lib/callResults';
import { safeEqual } from '@/lib/secrets';

// Alert steps (family messages, the first round of emergency calls) run inside this request: give them the same
// 60 s as the cron rather than the platform default (as low as 10 s), and the cron's stalled-emergency check
// finishes anything a cut-off run left undone.
export const maxDuration = 60;

/**
 * Sarvam end-of-call webhook. Sarvam doesn't sign webhooks, so the URL we give
 * it carries `?token=<SARVAM_WEBHOOK_SECRET>`, verified here in constant time.
 */
export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get('token');
  if (!safeEqual(token, process.env.SARVAM_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  try {
    const outcome = await processSarvamWebhook(payload as Record<string, unknown>);
    if (outcome.status === 'invalid') {
      return NextResponse.json({ error: outcome.reason }, { status: 400 });
    }
    if (outcome.status === 'unknown_attempt') {
      // 404 (not 500) so the sender doesn't treat it as a transient error.
      return NextResponse.json({ error: 'Unknown call attempt' }, { status: 404 });
    }
    return NextResponse.json({ success: true, ...outcome });
  } catch (err) {
    console.error('[sarvam-webhook] Processing failed:', err);
    // 500 lets the sender retry; processing is idempotent so a retry is safe.
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
