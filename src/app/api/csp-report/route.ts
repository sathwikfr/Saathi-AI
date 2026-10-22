import { NextResponse } from 'next/server';
import { clientIp, consumeRateLimit } from '@/lib/security';

/**
 * Receives Content-Security-Policy-Report-Only violations (next.config.ts) and writes one short line
 * per report to the server log. Public on purpose (browsers send these without cookies); capped per IP
 * and by size so it can't be used to flood the logs. Stores nothing.
 */
const MAX_BYTES = 8 * 1024;

export async function POST(req: Request) {
  if (!consumeRateLimit(`csp:${clientIp(req)}`, 30, 60_000).allowed) return new NextResponse(null, { status: 204 });

  const text = (await req.text()).slice(0, MAX_BYTES);
  try {
    const body = JSON.parse(text);
    const r = body['csp-report'] || body;
    const page = String(r['document-uri'] || '').split('?')[0]; // no query strings in logs
    console.warn(`[csp] would block ${r['effective-directive'] || r['violated-directive']}: ${r['blocked-uri'] || 'inline'} on ${page}`);
  } catch {
    // not a CSP report: ignore
  }
  return new NextResponse(null, { status: 204 });
}
