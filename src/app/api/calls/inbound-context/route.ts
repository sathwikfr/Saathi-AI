import { NextResponse } from 'next/server';
import { buildInboundContext } from '@/lib/callResults';
import { requestSecret, routeSecret, safeEqual } from '@/lib/secrets';

/**
 * Sarvam "on-start" hook for call-backs: before Saathi speaks, it asks who is
 * calling. We look the caller up by phone and return the same input variables an
 * outbound call gets (parent name, unconfirmed medicines, consent question, …).
 *
 * Auth: `Authorization: Bearer SARVAM_WEBHOOK_SECRET` (or `?token=`).
 * Sarvam's exact request shape for on-start isn't documented publicly, so the
 * caller's number is read from any of the usual fields; map the response fields
 * to agent variables in the Sarvam dashboard (docs/sarvam-agent.md §10).
 */
function callerFrom(body: Record<string, unknown>, url: URL): string {
  const candidates = [
    body.user_phone_number, body.phone_number, body.phone, body.caller, body.from, body.user_identifier,
    (body.user as Record<string, unknown> | undefined)?.phone_number, url.searchParams.get('phone')
  ];
  for (const c of candidates) if (typeof c === 'string' && /\d{6,}/.test(c)) return c;
  return '';
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const secret = requestSecret(req, 'x-sarvam-secret') || url.searchParams.get('token');
  if (!safeEqual(secret, routeSecret('SARVAM_INBOUND_CONTEXT_SECRET'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = ((await req.json().catch(() => ({}))) || {}) as Record<string, unknown>;
  const caller = callerFrom(body, url);
  if (!caller) return NextResponse.json({ known_caller: 'no' });

  try {
    const ctx = await buildInboundContext(caller);
    if (!ctx) return NextResponse.json({ known_caller: 'no' });
    // Flat (for field mapping) and nested (for agents that read `agent_variables`).
    return NextResponse.json({ known_caller: 'yes', ...ctx.variables, agent_variables: ctx.variables });
  } catch (err) {
    console.error('[inbound-context] Failed:', err);
    return NextResponse.json({ known_caller: 'no' });
  }
}
