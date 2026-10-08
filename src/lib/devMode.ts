import { headers } from 'next/headers';

/**
 * Dev-only shortcuts (reset link in the response, OTP in the response, master OTP 123456, sandbox payments)
 * exist so the app can be tried on a laptop. They must never work for a stranger: a `next dev` server that is
 * shared through a tunnel (ngrok) still has NODE_ENV=development, so the check also needs the request to have
 * come to a loopback host directly. Vercel preview and production builds are never `development`.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLocalDevHeaders(h: Headers): boolean {
  if (process.env.NODE_ENV !== 'development') return false;
  // A tunnel or proxy adds these; a direct browser-to-localhost request does not.
  if (h.get('x-forwarded-host') || h.get('x-forwarded-for') || h.get('forwarded') || h.get('x-real-ip')) return false;
  const host = (h.get('host') || '').toLowerCase().replace(/:\d+$/, '');
  return LOCAL_HOSTS.has(host);
}

/** For code that has no `req` in hand. Outside a request (scripts, tests) there is no network caller, so dev allows it. */
export async function isLocalDevRequest(): Promise<boolean> {
  if (process.env.NODE_ENV !== 'development') return false;
  try {
    return isLocalDevHeaders(await headers());
  } catch {
    return true;
  }
}
