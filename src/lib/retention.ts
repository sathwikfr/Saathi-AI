/**
 * Call transcripts are kept for TRANSCRIPT_RETENTION_DAYS (default 90, decided
 * 2026-10-03), then the transcript text is cleared. The call log itself, its
 * summary, per-medicine results, mood and alerts are kept (rule 6: call logs are
 * never deleted), so trends and the timeline keep working.
 * Set TRANSCRIPT_RETENTION_DAYS=0 to switch the clean-up off.
 */
import { prisma } from './prisma';

export const DEFAULT_TRANSCRIPT_RETENTION_DAYS = 90;

export function transcriptRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TRANSCRIPT_RETENTION_DAYS?.trim();
  if (raw === undefined || raw === '') return DEFAULT_TRANSCRIPT_RETENTION_DAYS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TRANSCRIPT_RETENTION_DAYS;
}

export async function clearOldTranscripts(opts: { now?: Date; parentIds?: string[] } = {}): Promise<{ cleared: number; days: number }> {
  const days = transcriptRetentionDays();
  if (days === 0) return { cleared: 0, days };
  const before = new Date((opts.now || new Date()).getTime() - days * 86400000);
  const res = await prisma.callLog.updateMany({
    where: {
      createdAt: { lt: before },
      transcriptJson: { not: null },
      ...(opts.parentIds ? { parentId: { in: opts.parentIds } } : {})
    },
    data: { transcriptJson: null }
  });
  return { cleared: res.count, days };
}
