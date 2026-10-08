import { NextResponse } from 'next/server';
import { isLocalDevRequest } from '@/lib/devMode';
import { getUserByPhone, isPhoneRegistered } from '@/lib/db';
import { checkRateLimit, recordFailedAttempt, createAndStoreOtp } from '@/lib/security';
import { normalizePhone } from '@/lib/phone';

/**
 * No SMS provider is integrated yet. Outside local development the OTP would
 * never reach the user, so phone OTP is reported as unavailable instead of
 * pretending a code was sent.
 */
async function smsDeliveryAvailable(): Promise<boolean> {
  return isLocalDevRequest();
}

export async function POST(req: Request) {
  try {
    const { phone, purpose = 'login' } = await req.json();

    if (purpose !== 'login' && purpose !== 'signup') {
      return NextResponse.json({ error: 'Invalid purpose' }, { status: 400 });
    }

    if (!phone) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
    }

    const phoneResult = normalizePhone(phone);
    if (!phoneResult.ok) {
      return NextResponse.json({ error: phoneResult.reason }, { status: 400 });
    }

    if (!(await smsDeliveryAvailable())) {
      return NextResponse.json(
        {
          error: 'Mobile OTP sign-in is not available yet. Please use your email and password.',
          code: 'OTP_UNAVAILABLE'
        },
        { status: 503 }
      );
    }

    const cleanPhone = phoneResult.e164.replace(/\D/g, '');
    const rateLimitKey = `otp_send:${cleanPhone}`;

    // Max 3 requests per 10 minutes
    const rateStatus = checkRateLimit(rateLimitKey, 3, 10 * 60 * 1000);
    if (!rateStatus.allowed) {
      return NextResponse.json(
        {
          error: `Too many OTP requests. Please wait ${Math.ceil((rateStatus.retryAfterSec || 600) / 60)} minutes before requesting another code.`
        },
        { status: 429 }
      );
    }

    if (purpose === 'login') {
      if (!(await getUserByPhone(phoneResult.e164))) {
        return NextResponse.json(
          {
            error: 'No account registered with this mobile number. Please sign up first.',
            notFound: true,
            code: 'ACCOUNT_NOT_FOUND'
          },
          { status: 404 }
        );
      }
    } else if (await isPhoneRegistered(phoneResult.e164)) {
      return NextResponse.json(
        { error: 'An account with this mobile number already exists. Please log in instead.', code: 'ACCOUNT_EXISTS' },
        { status: 409 }
      );
    }

    recordFailedAttempt(rateLimitKey, 10 * 60 * 1000);
    const { code } = await createAndStoreOtp(cleanPhone, purpose);

    console.log(`[Aaptha SMS Gateway][dev] OTP for ${phoneResult.e164}: ${code}`);

    return NextResponse.json({
      success: true,
      message: `A 6-digit verification code has been sent to ••••${cleanPhone.slice(-4)}`,
      devOtp: code
    });
  } catch (err) {
    console.error('Send OTP error:', err);
    return NextResponse.json({ error: 'Failed to dispatch verification code.' }, { status: 500 });
  }
}
