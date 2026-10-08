import { NextResponse } from 'next/server';
import { getUserByEmail, createUser } from '@/lib/db';
import { AUTH_COOKIE_NAME } from '@/lib/auth';
import { createDBSession, isCrossSiteRequest, CROSS_SITE_ERROR } from '@/lib/security';
import { prisma } from '@/lib/prisma';

/**
 * Google Sign-In. The browser obtains a Google ID token (credential) from
 * Google Identity Services; we verify it with Google before trusting the email.
 * Requires GOOGLE_CLIENT_ID (server) and NEXT_PUBLIC_GOOGLE_CLIENT_ID (browser).
 */
interface GoogleTokenInfo {
  aud?: string;
  iss?: string;
  email?: string;
  email_verified?: string | boolean;
  name?: string;
  exp?: string;
  sub?: string;
}

function getGoogleClientId(): string | null {
  return process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || null;
}

async function verifyGoogleCredential(credential: string, clientId: string): Promise<GoogleTokenInfo | null> {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`, {
    cache: 'no-store'
  });
  if (!res.ok) return null;
  const info = (await res.json()) as GoogleTokenInfo;

  const issuerOk = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
  const audienceOk = info.aud === clientId;
  const verified = info.email_verified === true || info.email_verified === 'true';
  const notExpired = info.exp ? Number(info.exp) * 1000 > Date.now() : false;

  if (!issuerOk || !audienceOk || !verified || !notExpired || !info.email) return null;
  return info;
}

function withSessionCookie(response: NextResponse, token: string, rememberMe: boolean) {
  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: rememberMe ? 30 * 24 * 60 * 60 : 24 * 60 * 60
  });
  return response;
}

async function recordOAuthLink(userId: string, email: string) {
  const existing = await prisma.oAuthAccount.findFirst({ where: { userId, provider: 'google' } });
  if (!existing) {
    await prisma.oAuthAccount.create({ data: { userId, provider: 'google', email } });
  }
}

export async function POST(req: Request) {
  if (isCrossSiteRequest(req.headers)) return NextResponse.json(CROSS_SITE_ERROR, { status: 403 });
  try {
    const clientId = getGoogleClientId();
    if (!clientId) {
      return NextResponse.json(
        { error: 'Google sign-in is not configured yet. Please use email and password.', code: 'GOOGLE_NOT_CONFIGURED' },
        { status: 503 }
      );
    }

    const { credential, mode = 'login', rememberMe = true } = await req.json();
    if (!credential || typeof credential !== 'string') {
      return NextResponse.json({ error: 'Missing Google credential.' }, { status: 400 });
    }

    const info = await verifyGoogleCredential(credential, clientId);
    if (!info?.email) {
      return NextResponse.json({ error: 'Google sign-in could not be verified. Please try again.' }, { status: 401 });
    }

    const cleanEmail = info.email.toLowerCase().trim();
    const existingUser = await getUserByEmail(cleanEmail);

    if (mode === 'login') {
      if (!existingUser) {
        return NextResponse.json(
          {
            error: `No Aaptha account is registered with ${cleanEmail}. Would you like to create an account?`,
            notFound: true,
            code: 'ACCOUNT_NOT_FOUND',
            enteredEmail: cleanEmail
          },
          { status: 404 }
        );
      }

      await recordOAuthLink(existingUser.id, cleanEmail);
      const session = await createDBSession(existingUser.id, rememberMe);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { passwordHash, ...user } = existingUser;
      return withSessionCookie(
        NextResponse.json({ success: true, message: 'Logged in successfully with Google', user }),
        session.token,
        rememberMe
      );
    }

    if (mode === 'signup') {
      if (existingUser) {
        return NextResponse.json(
          { error: `An account for ${cleanEmail} already exists. Please log in instead.`, code: 'ACCOUNT_EXISTS' },
          { status: 409 }
        );
      }

      const newUser = await createUser({
        name: info.name || cleanEmail.split('@')[0],
        email: cleanEmail,
        phone: null,
        emailVerified: true
      });
      await recordOAuthLink(newUser.id, cleanEmail);
      const session = await createDBSession(newUser.id, rememberMe);

      return withSessionCookie(
        NextResponse.json({ success: true, message: 'Account created with Google', user: newUser }),
        session.token,
        rememberMe
      );
    }

    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
  } catch (err) {
    console.error('Google auth error:', err);
    return NextResponse.json({ error: 'Google authentication failed' }, { status: 500 });
  }
}
