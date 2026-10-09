import { NextResponse } from 'next/server';
import { processWhatsAppWebhook } from '@/lib/whatsappInbound';
import { verifyMetaSignature } from '@/lib/whatsapp';
import { safeEqual } from '@/lib/secrets';

// Alert steps (family messages, the first round of emergency calls) run inside this request: give them the same
// 60 s as the cron rather than the platform default (as low as 10 s), and the cron's stalled-emergency check
// finishes anything a cut-off run left undone.
export const maxDuration = 60;

/**
 * Meta WhatsApp webhook.
 * GET:  one-time verification when the webhook is added in the Meta app
 *       (`hub.verify_token` must equal WHATSAPP_VERIFY_TOKEN).
 * POST: delivery statuses + family replies, signed with the app secret
 *       (`X-Hub-Signature-256`, WHATSAPP_APP_SECRET).
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  if (params.get('hub.mode') === 'subscribe' && safeEqual(params.get('hub.verify_token'), process.env.WHATSAPP_VERIFY_TOKEN)) {
    return new Response(params.get('hub.challenge') || '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'), process.env.WHATSAPP_APP_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const summary = await processWhatsAppWebhook(body);
    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    console.error('[whatsapp-webhook] Processing failed:', err);
    // 500 makes Meta retry; processing is idempotent.
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
