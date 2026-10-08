import { NextResponse } from 'next/server';
import { getUserByPhone, isPhoneRegistered, createUser } from '@/lib/db';
import { AUTH_COOKIE_NAME } from '@/lib/auth';
import { verifyAndConsumeOtp, createDBSession, isCrossSiteRequest, CROSS_SITE_ERROR } from '@/lib/security';
import { normalizePhone } from '@/lib/phone';

export async function POST(req: Request) {
  // Another site must not be able to log a visitor into an account it controls (login CSRF).
  if (isCrossSiteRequest(req.headers)) return NextResponse.json(CROSS_SITE_ERROR, { status: 403 });
  try {
    const { phone, code, purpose = 'login', name, rememberMe = true } = await req.json();

    if (!phone || !code) {
      return NextResponse.json({ error: 'Mobile number and verification code are required.' }, { status: 400 });
    }

    const phoneResult = normalizePhone(phone);
    if (!phoneResult.ok) {
      return NextResponse.json({ error: phoneResult.reason }, { status: 400 });
    }

    const cleanPhone = phoneResult.e164.replace(/\D/g, '');

    // 1. Strict Existence Check for Login
    if (purpose === 'login') {
      const existingUser = await getUserByPhone(phoneResult.e164);
      if (!existingUser) {
        return NextResponse.json(
          {
            error: 'No account registered with this phone number. Please sign up first.',
            notFound: true,
            code: 'ACCOUNT_NOT_FOUND'
          },
          { status: 404 }
        );
      }

      // Verify OTP code
      const verifyResult = await verifyAndConsumeOtp(cleanPhone, code.trim(), 'login');
      if (!verifyResult.success) {
        return NextResponse.json({ error: verifyResult.error }, { status: 400 });
      }

      // Success: Create DB Session
      const session = await createDBSession(existingUser.id, rememberMe);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { passwordHash, ...user } = existingUser;

      const response = NextResponse.json({
        success: true,
        message: 'Logged in successfully via OTP verification',
        user
      });

      const maxAgeSeconds = rememberMe ? 30 * 24 * 60 * 60 : 24 * 60 * 60;
      response.cookies.set(AUTH_COOKIE_NAME, session.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: maxAgeSeconds
      });

      return response;
    }

    // 2. Signup Verification
    if (purpose === 'signup') {
      if (await isPhoneRegistered(phoneResult.e164)) {
        return NextResponse.json(
          { error: 'An account with this mobile number already exists. Please log in instead.' },
          { status: 409 }
        );
      }

      const verifyResult = await verifyAndConsumeOtp(cleanPhone, code.trim(), 'signup');
      if (!verifyResult.success) {
        return NextResponse.json({ error: verifyResult.error }, { status: 400 });
      }

      // Create new user (Sign up action only)
      const newUser = await createUser({
        name: name || 'Caregiver',
        email: `${cleanPhone}@carecircle.user`,
        phone: phoneResult.e164,
        phoneVerified: true
      });

      const session = await createDBSession(newUser.id, rememberMe);

      const response = NextResponse.json({
        success: true,
        message: 'Account created and verified successfully',
        user: newUser
      });

      const maxAgeSeconds = rememberMe ? 30 * 24 * 60 * 60 : 24 * 60 * 60;
      response.cookies.set(AUTH_COOKIE_NAME, session.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: maxAgeSeconds
      });

      return response;
    }

    return NextResponse.json({ error: 'Invalid purpose' }, { status: 400 });
  } catch (err) {
    console.error('Verify OTP error:', err);
    return NextResponse.json({ error: 'Verification failed. Please try again.' }, { status: 500 });
  }
}
