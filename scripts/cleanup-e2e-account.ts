/**
 * Removes ONE throwaway test account created while testing on localhost (CLAUDE.md rule 10).
 *
 *   npx tsx scripts/cleanup-e2e-account.ts claude-e2e-1234567890@example.com            # dry run
 *   npx tsx scripts/cleanup-e2e-account.ts claude-e2e-1234567890@example.com --confirm  # delete
 *
 * Only accepts claude-e2e-<digits>@example.com, so it can never touch a real family's data.
 * Deleting the User cascades to sessions, subscription, invoices, notification prefs and the
 * account's parents (and their slots, medicines, contacts, call logs, alerts, invites).
 * Rows without a cascade (medicine reports, reset tokens, OAuth links, OTPs) are removed first.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

const E2E_EMAIL = /^claude-e2e-\d+@example\.com$/;

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  const confirm = process.argv.includes('--confirm');

  if (!E2E_EMAIL.test(email)) {
    console.error('Refusing: pass a claude-e2e-<digits>@example.com address.');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.log(`No account for ${email}; nothing to do.`);
    return;
  }

  const parentIds = (await prisma.parentProfile.findMany({ where: { userId: user.id }, select: { id: true } })).map(p => p.id);
  const byParent = { parentId: { in: parentIds } };

  const counts = {
    sessions: await prisma.dBSession.count({ where: { userId: user.id } }),
    parents: parentIds.length,
    slots: await prisma.scheduledCallSlot.count({ where: byParent }),
    medicines: await prisma.medicine.count({ where: byParent }),
    emergencyContacts: await prisma.emergencyContact.count({ where: byParent }),
    callLogs: await prisma.callLog.count({ where: byParent }),
    alerts: await prisma.alertRecord.count({ where: byParent }),
    suggestions: await prisma.scheduleSuggestion.count({ where: byParent }),
    caregiverInvites: await prisma.caregiverInvite.count({ where: byParent }),
    medicineReports: await prisma.medicineReport.count({ where: { OR: [{ userId: user.id }, byParent] } }),
    subscriptions: await prisma.userSubscription.count({ where: { userId: user.id } }),
    invoices: await prisma.invoice.count({ where: { userId: user.id } }),
    notificationPrefs: await prisma.notificationPreferences.count({ where: { userId: user.id } }),
    resetTokens: await prisma.passwordResetRecord.count({ where: { userId: user.id } }),
    oauthLinks: await prisma.oAuthAccount.count({ where: { userId: user.id } }),
    otps: user.phone ? await prisma.oTPRecord.count({ where: { phone: user.phone } }) : 0,
    medicineReminders: await prisma.medicineReminder.count({ where: byParent }),
    // No foreign key to User, so these don't cascade.
    billShares: await prisma.billShare.count({ where: { OR: [{ ownerId: user.id }, { memberId: user.id }] } }),
    whatsappMessages: await prisma.whatsAppMessage.count({ where: { OR: [{ userId: user.id }, byParent] } })
  };

  console.log(`Account ${email} (${user.id}) owns:`);
  console.table(counts);

  if (!confirm) {
    console.log('Dry run. Re-run with --confirm to delete these rows.');
    return;
  }

  await prisma.$transaction([
    prisma.medicineReport.deleteMany({ where: { OR: [{ userId: user.id }, byParent] } }),
    prisma.passwordResetRecord.deleteMany({ where: { userId: user.id } }),
    prisma.oAuthAccount.deleteMany({ where: { userId: user.id } }),
    ...(user.phone ? [prisma.oTPRecord.deleteMany({ where: { phone: user.phone } })] : []),
    prisma.billShare.deleteMany({ where: { OR: [{ ownerId: user.id }, { memberId: user.id }] } }),
    prisma.whatsAppMessage.deleteMany({ where: { OR: [{ userId: user.id }, byParent] } }),
    prisma.user.delete({ where: { id: user.id } })
  ]);

  console.log(`Deleted ${email} and everything it owned.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
