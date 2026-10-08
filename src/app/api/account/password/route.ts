import { NextResponse } from 'next/server';
import { getSessionUser, getSessionToken, comparePassword, hashPassword } from '@/lib/auth';
import { checkRateLimit, recordFailedAttempt, clearRateLimit, revokeOtherUserSessions } from '@/lib/security';
import { getUserPasswordHash, updateUserPasswordHash } from '@/lib/db';

export async function POST(req: Request) {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    const body = await req.json();
    const { currentPassword, newPassword, confirmPassword } = body;

    if (!currentPassword || typeof currentPassword !== 'string') {
      return NextResponse.json({ error: 'Please enter your current password.' }, { status: 400 });
    }

    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      return NextResponse.json({ error: 'New password must be at least 8 characters long.' }, { status: 400 });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return NextResponse.json({ error: 'New passwords do not match.' }, { status: 400 });
    }

    const currentHash = await getUserPasswordHash(sessionUser.id);
    if (!currentHash) {
      return NextResponse.json({
        error: 'No password is set for this account (you may have signed in via Google or OTP). Please use reset password or set a password.'
      }, { status: 400 });
    }

    const limitKey = `pwchange:${sessionUser.id}`;
    const limit = checkRateLimit(limitKey, 5, 15 * 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Too many wrong passwords. Please try again in a few minutes.' }, { status: 429 });
    }
    const isMatch = await comparePassword(currentPassword, currentHash);
    if (!isMatch) {
      recordFailedAttempt(limitKey);
      return NextResponse.json({ error: 'Incorrect current password. Please try again.' }, { status: 400 });
    }
    clearRateLimit(limitKey);

    const newHash = await hashPassword(newPassword);
    const updated = await updateUserPasswordHash(sessionUser.id, newHash);

    if (!updated) {
      return NextResponse.json({ error: 'Failed to update password.' }, { status: 500 });
    }

    // A changed password must end every other login (a stolen session must not survive it).
    await revokeOtherUserSessions(sessionUser.id, await getSessionToken());

    return NextResponse.json({
      success: true,
      message: 'Password updated successfully. Other devices have been signed out.'
    });
  } catch (err) {
    console.error('Account Password POST Error:', err);
    return NextResponse.json({ error: 'Failed to process password change request.' }, { status: 500 });
  }
}
