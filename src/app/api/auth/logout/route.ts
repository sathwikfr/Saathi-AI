import { NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, getSessionToken } from '@/lib/auth';
import { revokeDBSession, isCrossSiteRequest, CROSS_SITE_ERROR } from '@/lib/security';

export async function POST(req: Request) {
  // Another site must not be able to sign someone out (login CSRF set-up).
  if (isCrossSiteRequest(req.headers)) return NextResponse.json(CROSS_SITE_ERROR, { status: 403 });
  const token = await getSessionToken();
  if (token) {
    try {
      await revokeDBSession(token);
    } catch (err) {
      console.error('[logout] Failed to revoke session:', err);
    }
  }
  const response = NextResponse.json({ success: true, message: 'Logged out successfully' });
  response.cookies.delete(AUTH_COOKIE_NAME);
  return response;
}
