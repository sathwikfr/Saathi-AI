import crypto from 'crypto';

/** Constant-time string comparison; false when either side is missing. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Reads a secret from `Authorization: Bearer …` or the given header name. */
export function requestSecret(req: Request, headerName: string): string | null {
  const auth = req.headers.get('authorization');
  if (auth && /^bearer /i.test(auth)) return auth.slice(7).trim();
  return req.headers.get(headerName);
}

/**
 * The secret one Sarvam-facing route accepts. A route-specific variable (e.g. SARVAM_ESCALATE_SECRET) wins when
 * it is set, so leaking the end-of-call webhook URL (the token sits in its query string) no longer also opens
 * the emergency tool or the call-back lookup. Unset = the shared SARVAM_WEBHOOK_SECRET, as before.
 */
export function routeSecret(specificEnvName: 'SARVAM_ESCALATE_SECRET' | 'SARVAM_INBOUND_CONTEXT_SECRET'): string | undefined {
  return process.env[specificEnvName]?.trim() || process.env.SARVAM_WEBHOOK_SECRET;
}
