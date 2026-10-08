import { prisma } from '../src/lib/prisma';

/**
 * DANGEROUS: deletes every user, parent, medicine, call and alert in the database the app is connected to
 * (the live Supabase DB, there is no separate dev one). It refuses to run unless you deliberately say so twice:
 *   WIPE_DATABASE_HOST=<the host of DATABASE_URL> npx tsx scripts/clear-database.ts --i-understand-this-deletes-everything
 * Take a backup first (scripts/backup-database.ts). It is also stale: it misses newer tables.
 */
function refuseUnlessDeliberate(): void {
  let host = '';
  try {
    host = new URL(process.env.DATABASE_URL || '').hostname;
  } catch {
    /* no usable DATABASE_URL */
  }
  const flagged = process.argv.includes('--i-understand-this-deletes-everything');
  if (!flagged || !host || process.env.WIPE_DATABASE_HOST !== host) {
    console.error('Refusing to wipe the database.');
    console.error(`Target host: ${host || '(unknown)'}`);
    console.error('To really do it: set WIPE_DATABASE_HOST to that host and pass --i-understand-this-deletes-everything.');
    process.exit(1);
  }
}

async function clearAllData() {
  refuseUnlessDeliberate();
  console.log('Clearing all tables in Supabase PostgreSQL...');

  // Delete child records first to respect foreign key constraints
  await prisma.scheduledCallSlot.deleteMany({});
  await prisma.medicine.deleteMany({});
  await prisma.emergencyContact.deleteMany({});
  await prisma.callLog.deleteMany({});
  await prisma.alertRecord.deleteMany({});
  await prisma.scheduleSuggestion.deleteMany({});
  await prisma.caregiverInvite.deleteMany({});
  await prisma.medicineReport.deleteMany({});
  await prisma.parentProfile.deleteMany({});
  await prisma.invoice.deleteMany({});
  await prisma.userSubscription.deleteMany({});
  await prisma.notificationPreferences.deleteMany({});
  await prisma.dBSession.deleteMany({});
  await prisma.passwordResetRecord.deleteMany({});
  await prisma.oTPRecord.deleteMany({});
  await prisma.user.deleteMany({});

  console.log('All data deleted successfully from Supabase PostgreSQL!');
}

clearAllData()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
