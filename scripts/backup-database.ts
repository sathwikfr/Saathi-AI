/**
 * Read-only JSON backup of every table: `npx tsx scripts/backup-database.ts [outDir]`
 *
 * Take one before any schema change (CLAUDE.md rule 1). The file holds personal data, so it is written
 * OUTSIDE the repo (default: ../aaptha-db-backups next to the project folder) and must never be committed.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/lib/prisma';

async function main() {
  const outDir = path.resolve(process.argv[2] || path.join(process.cwd(), '..', 'aaptha-db-backups'));
  if (outDir.startsWith(path.resolve(process.cwd()) + path.sep)) {
    throw new Error('Refusing to write a backup inside the repo (it contains personal data).');
  }
  fs.mkdirSync(outDir, { recursive: true });

  // Every model in prisma/schema.prisma (delegates are camelCase).
  const tables = {
    user: () => prisma.user.findMany(),
    emailLog: () => prisma.emailLog.findMany(),
    whatsAppMessage: () => prisma.whatsAppMessage.findMany(),
    dBSession: () => prisma.dBSession.findMany(),
    oTPRecord: () => prisma.oTPRecord.findMany(),
    passwordResetRecord: () => prisma.passwordResetRecord.findMany(),
    oAuthAccount: () => prisma.oAuthAccount.findMany(),
    userSubscription: () => prisma.userSubscription.findMany(),
    invoice: () => prisma.invoice.findMany(),
    parentProfile: () => prisma.parentProfile.findMany(),
    scheduledCallSlot: () => prisma.scheduledCallSlot.findMany(),
    medicine: () => prisma.medicine.findMany(),
    emergencyContact: () => prisma.emergencyContact.findMany(),
    callLog: () => prisma.callLog.findMany(),
    alertRecord: () => prisma.alertRecord.findMany(),
    scheduleSuggestion: () => prisma.scheduleSuggestion.findMany(),
    caregiverInvite: () => prisma.caregiverInvite.findMany(),
    notificationPreferences: () => prisma.notificationPreferences.findMany(),
    medicineReport: () => prisma.medicineReport.findMany(),
    escalation: () => prisma.escalation.findMany(),
    escalationAttempt: () => prisma.escalationAttempt.findMany(),
    healthInsight: () => prisma.healthInsight.findMany(),
    healthDocument: () => prisma.healthDocument.findMany()
  };

  const dump: Record<string, unknown[]> = {};
  for (const [name, read] of Object.entries(tables)) {
    dump[name] = await read();
    console.log(`  ${name.padEnd(24)} ${dump[name].length}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(outDir, `db-backup-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ takenAt: new Date().toISOString(), tables: dump }, null, 2));
  console.log(`\nBackup written to ${file}`);
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
