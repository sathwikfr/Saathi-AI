import { NextResponse } from 'next/server';
import { getUserByEmail, isPhoneRegistered, createUser } from '@/lib/db';
import { hashPassword, AUTH_COOKIE_NAME } from '@/lib/auth';
import { createDBSession, clientIp, consumeRateLimit, isCrossSiteRequest, CROSS_SITE_ERROR } from '@/lib/security';
import { normalizePhone } from '@/lib/phone';
import { PLANS } from '@/lib/plans';
import { PlanId } from '@/lib/types';

export async function POST(req: Request) {
  if (isCrossSiteRequest(req.headers)) return NextResponse.json(CROSS_SITE_ERROR, { status: 403 });
  // Every signup sends an email and creates rows: cap scripted account creation per network.
  if (!consumeRateLimit(`signup-ip:${clientIp(req)}`, 10, 60 * 60 * 1000).allowed) {
    return NextResponse.json({ error: 'Too many new accounts from this network. Please try again later.', code: 'RATE_LIMITED' }, { status: 429 });
  }
  try {
    const body = await req.json();
    const { name, email, phone, password, planId } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Please enter your full name.' }, { status: 400 });
    }
    if (name.trim().length > 100) {
      return NextResponse.json({ error: 'Please enter a shorter name.' }, { status: 400 });
    }

    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }

    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      return NextResponse.json({ error: 'Please enter a valid mobile number.' }, { status: 400 });
    }
    const phoneResult = normalizePhone(phone);
    if (!phoneResult.ok) {
      return NextResponse.json({ error: phoneResult.reason }, { status: 400 });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters long.' }, { status: 400 });
    }
    // bcrypt only reads the first 72 bytes; a longer limit would silently ignore the rest.
    if (Buffer.byteLength(password, 'utf8') > 72) {
      return NextResponse.json({ error: 'Password can be at most 72 characters.' }, { status: 400 });
    }

    if (await getUserByEmail(email)) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Please log in instead.', code: 'ACCOUNT_EXISTS' },
        { status: 409 }
      );
    }

    if (await isPhoneRegistered(phoneResult.e164)) {
      return NextResponse.json(
        { error: 'An account with this mobile number already exists. Please log in instead.', code: 'ACCOUNT_EXISTS' },
        { status: 409 }
      );
    }

    const user = await createUser({
      name: name.trim(),
      email: email.trim(),
      phone: phoneResult.e164,
      passwordHash: await hashPassword(password),
      // Only the Free plan is granted at signup; paid plans require checkout.
      planId: planId && PLANS[planId as PlanId] ? (planId as PlanId) : undefined,
      emailVerified: true
    });

    const session = await createDBSession(user.id, true);

    const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const { sendVerificationEmail } = await import('@/lib/email');
    sendVerificationEmail({
      to: user.email,
      name: user.name,
      verifyUrl: `${origin}/dashboard`
    }).catch(err => console.error('[Aaptha Signup] Failed to dispatch welcome email:', err));

    const response = NextResponse.json({ success: true, user });
    response.cookies.set(AUTH_COOKIE_NAME, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60
    });
    return response;
  } catch (err) {
    console.error('Signup error:', err);
    return NextResponse.json({ error: 'An unexpected server error occurred.' }, { status: 500 });
  }
}
