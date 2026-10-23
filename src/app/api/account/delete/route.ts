import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { AUTH_COOKIE_NAME, comparePassword } from '@/lib/auth';
import { checkLastingLimit, recordLastingFailure, clearLastingLimit, revokeAllUserSessions } from '@/lib/security';
import { getUserPasswordHash } from '@/lib/db';
import { prisma } from '@/lib/prisma';
import { cancelRazorpaySubscription } from '@/lib/razorpay';

/**
 * Self-serve account deletion (DPDP right to erasure). Nothing is hard-deleted (CLAUDE.md rule 6):
 * the plan is cancelled at once, every parent profile is archived (calls and messages stop), the person's
 * contact details are wiped from the account and WhatsApp/email settings, the Google link is removed and
 * every session is revoked. Invoices stay (tax law); archived parent records are erased on request.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { password, confirm } = await req.json().catch(() => ({}));
  if (confirm !== 'DELETE') {
    return NextResponse.json({ error: 'Type DELETE to confirm.' }, { status: 400 });
  }

  const hash = await getUserPasswordHash(user.id);
  if (hash) {
    const limitKey = `acctdelete:${user.id}`;
    if (!(await checkLastingLimit(limitKey, 5, 15 * 60 * 1000)).allowed) {
      return NextResponse.json({ error: 'Too many wrong passwords. Please try again in a few minutes.' }, { status: 429 });
    }
    if (typeof password !== 'string' || !(await comparePassword(password, hash))) {
      await recordLastingFailure(limitKey);
      return NextResponse.json({ error: 'Incorrect password.' }, { status: 400 });
    }
    await clearLastingLimit(limitKey);
  }

  try {
    // Stop billing first: if Razorpay fails the account is untouched and the person can retry.
    await cancelRazorpaySubscription(user.subscription?.razorpaySubscriptionId, false);

    await prisma.$transaction([
      prisma.userSubscription.updateMany({
        where: { userId: user.id },
        data: { status: 'cancelled', cancelAtPeriodEnd: true, cancelledAt: new Date(), cancelReason: 'Account deleted' }
      }),
      prisma.parentProfile.updateMany({ where: { userId: user.id }, data: { isDeleted: true } }),
      prisma.notificationPreferences.updateMany({
        where: { userId: user.id },
        data: {
          whatsapp: false, email: false, whatsappNumber: null, whatsappOptInAt: null,
          whatsappVerifiedAt: null, emergencyPhone: null
        }
      }),
      prisma.oAuthAccount.deleteMany({ where: { userId: user.id } }),
      prisma.user.update({
        where: { id: user.id },
        data: {
          name: 'Deleted account', email: `deleted-${user.id}@carecircle.user`, phone: null, avatar: null,
          passwordHash: null, upiId: null, emailVerified: false, phoneVerified: false
        }
      })
    ]);
    await revokeAllUserSessions(user.id);
  } catch (err) {
    console.error('[account-delete] failed:', err);
    return NextResponse.json({ error: 'We could not delete your account. Nothing was changed; please try again or write to us.' }, { status: 500 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.delete(AUTH_COOKIE_NAME);
  return response;
}
