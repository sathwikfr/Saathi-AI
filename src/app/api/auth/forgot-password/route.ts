import { NextResponse } from 'next/server';
import { isLocalDevRequest } from '@/lib/devMode';
import { getUserByEmail } from '@/lib/db';
import { createPasswordResetToken, checkRateLimit, recordFailedAttempt } from '@/lib/security';
import { sendPasswordResetEmail } from '@/lib/email';

export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }

    const cleanEmail = email.toLowerCase().trim();
    const rateLimitKey = `forgot:${cleanEmail}`;

    // 1. Rate limiting (max 3 requests in 15 minutes)
    const rateStatus = checkRateLimit(rateLimitKey, 3, 15 * 60 * 1000);
    if (!rateStatus.allowed) {
      return NextResponse.json(
        {
          error: `Too many password reset requests. For security, please wait ${Math.ceil((rateStatus.retryAfterSec || 900) / 60)} minutes before trying again.`
        },
        { status: 429 }
      );
    }

    recordFailedAttempt(rateLimitKey);

    // 2. Strict Account Check (Generic Response - No Enumeration)
    const user = await getUserByEmail(cleanEmail);
    let resetToken: string | undefined = undefined;

    if (user) {
      resetToken = await createPasswordResetToken(user.id);

      // Determine application base URL
      // Never from the request: an Origin/Host header is attacker-controlled and this link is emailed to the victim.
      const origin = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
      const resetUrl = `${origin}/reset-password?token=${resetToken}&email=${encodeURIComponent(cleanEmail)}`;

      // 3. Dispatch real transactional email via Resend
      const emailResult = await sendPasswordResetEmail({
        to: cleanEmail,
        name: user.name,
        resetUrl,
        expiresInMinutes: 20
      });

      console.log(`[Aaptha Auth] Password reset email triggered for ${cleanEmail}. Result:`, emailResult);
    } else {
      console.log(`[Aaptha Auth] Forgot password requested for unregistered email ${cleanEmail} (Silently ignored, generic message returned).`);
    }

    return NextResponse.json({
      success: true,
      message: `If an account exists for ${cleanEmail}, a secure password reset link valid for 20 minutes has been sent to your inbox.`,
      devResetLink: ((await isLocalDevRequest()) && resetToken)
        ? `/reset-password?token=${resetToken}&email=${encodeURIComponent(cleanEmail)}`
        : undefined
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    return NextResponse.json({ error: 'Failed to process password reset request.' }, { status: 500 });
  }
}
