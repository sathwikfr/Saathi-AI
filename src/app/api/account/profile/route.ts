import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getUserById, updateUserProfile } from '@/lib/db';
import { sendVerificationEmail } from '@/lib/email';
import { NotificationPreferences } from '@/lib/types';
import { normalizePhone } from '@/lib/phone';

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    const freshUser = (await getUserById(user.id)) || user;
    return NextResponse.json({
      success: true,
      user: freshUser
    });
  } catch (err) {
    console.error('Account Profile GET Error:', err);
    return NextResponse.json({ error: 'Failed to retrieve profile.' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    const body = await req.json();
    const { name, email, phone, avatar, notificationPreferences } = body;

    if (name !== undefined && (!name || typeof name !== 'string' || name.trim().length < 2)) {
      return NextResponse.json({ error: 'Full name must be at least 2 characters.' }, { status: 400 });
    }

    if (email !== undefined) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || typeof email !== 'string' || !emailRegex.test(email.trim())) {
        return NextResponse.json({ error: 'Please provide a valid email address.' }, { status: 400 });
      }
    }

    let normalizedPhone: string | undefined = undefined;
    if (phone !== undefined) {
      if (typeof phone !== 'string') {
        return NextResponse.json({ error: 'Invalid phone format.' }, { status: 400 });
      }
      if (phone.trim() !== '') {
        const phoneResult = normalizePhone(phone);
        if (!phoneResult.ok) {
          return NextResponse.json({ error: phoneResult.reason }, { status: 400 });
        }
        normalizedPhone = phoneResult.e164;
      } else {
        normalizedPhone = '';
      }
    }

    // Partial updates are fine: db.updateUserProfile whitelists and validates each field it is given.
    const cleanNotifPrefs: Partial<NotificationPreferences> | undefined =
      notificationPreferences && typeof notificationPreferences === 'object' ? notificationPreferences : undefined;

    const updateResult = await updateUserProfile(sessionUser.id, {
      name,
      email,
      phone: normalizedPhone !== undefined ? normalizedPhone : phone,
      avatar,
      notificationPreferences: cleanNotifPrefs
    });

    if (!updateResult) {
      return NextResponse.json({ error: 'User account not found.' }, { status: 404 });
    }

    const { user: updatedUser, emailChanged } = updateResult;

    // If email was changed, trigger verification email
    let emailVerificationTriggered = false;
    if (emailChanged && updatedUser.email) {
      try {
        const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/dashboard?verified=pending`;
        await sendVerificationEmail({
          to: updatedUser.email,
          name: updatedUser.name,
          verifyUrl
        });
        emailVerificationTriggered = true;
      } catch (emailErr) {
        console.warn('Failed to send verification email after address change:', emailErr);
      }
    }

    return NextResponse.json({
      success: true,
      message: emailChanged
        ? 'Profile updated. A verification link has been sent to your new email.'
        : 'Profile updated successfully.',
      user: updatedUser,
      emailVerificationTriggered
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update profile.';
    console.error('Account Profile PATCH Error:', err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
