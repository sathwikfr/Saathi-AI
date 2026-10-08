import { NextResponse } from 'next/server';
import { runDispatch } from '@/lib/callDispatch';
import { runLifecycleEmails } from '@/lib/lifecycleEmails';
import { advanceEscalations } from '@/lib/escalation';
import { runDigests } from '@/lib/digests';
import { runInsightsForAll } from '@/lib/insights';
import { clearOldTranscripts } from '@/lib/retention';
import { istMinutesOfDay } from '@/lib/ist';
import { requestSecret, safeEqual } from '@/lib/secrets';
import { runReminders } from '@/lib/reminders';
import { prisma } from '@/lib/prisma';

/** Daily jobs run in the first cron tick(s) after 9:30 PM IST; running twice is harmless (unique keys). */
const DAILY_JOBS_FROM_MINUTES = 21 * 60 + 30;
const DAILY_JOBS_WINDOW_MINUTES = 10;

// ponytail: 60 s is allowed on every Vercel plan (Hobby without Fluid compute). Escalations run first, so a run
// cut off at 60 s delays calls/reminders by one 5-minute tick, never an emergency. Raise it (Fluid: up to 300)
// once one run places more calls than fit in a minute.
export const maxDuration = 60;

/**
 * Cron entry point: an external scheduler (cron-job.org, Vercel Cron, …) calls
 * this every ~5 minutes with the CRON_SECRET, either as `x-cron-secret` or as
 * `Authorization: Bearer <secret>` (what Vercel Cron sends).
 *
 * Every run: places due calls, sends due WhatsApp medicine reminders, moves emergency escalations to their next step,
 * sends summaries that are due (each person's own hour and time zone) and the
 * trial reminder emails. Once a day: trend checks for every parent and the
 * 90-day transcript clean-up. Each job is independent: one failing never stops the rest.
 */
async function runStep<T>(failures: string[], name: string, fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[cron/dispatch] ${name} failed:`, err);
    failures.push(name);
    return { error: `${name} failed` };
  }
}

/**
 * Dead-man's switch: with CRON_HEARTBEAT_URL set (a Healthchecks.io check, or any service with the same
 * "ping URL, append /fail" convention) every run pings it, so someone is emailed when the runs STOP, not
 * only when one fails. Never throws and never holds the run up for more than 5 seconds.
 */
/** Stamps the CronRun row /admin reads. Never throws: a missing table (SQL not applied yet) only logs. */
async function recordRun(startedAt: Date, failed: string[]) {
  const data = { lastRunAt: new Date(), ok: failed.length === 0, failed: failed.join(', ') || null, durationMs: Date.now() - startedAt.getTime() };
  try {
    await prisma.cronRun.upsert({ where: { name: 'dispatch' }, create: { name: 'dispatch', ...data }, update: data });
  } catch (err) {
    console.error('[cron/dispatch] Could not record the run:', err);
  }
}

async function heartbeat(failed: boolean) {
  const url = process.env.CRON_HEARTBEAT_URL?.trim();
  if (!url) return;
  try {
    await fetch(failed ? `${url.replace(/\/+$/, '')}/fail` : url, { method: 'POST', signal: AbortSignal.timeout(5000) });
  } catch (err) {
    console.error('[cron/dispatch] Heartbeat ping failed:', err);
  }
}

async function handle(req: Request) {
  if (!safeEqual(requestSecret(req, 'x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const failures: string[] = [];
  const step = <T,>(name: string, fn: () => Promise<T>) => runStep(failures, name, fn);
  // An emergency that is already being worked on comes first: placing a morning's worth of calls can be slow,
  // and if this run is cut off the next round of phone calls must not be the thing that is left undone.
  const escalations = await step('Escalations', () => advanceEscalations({ now }));
  let dispatch: Awaited<ReturnType<typeof runDispatch>> | null = null;
  let dispatchFailed = false;
  try {
    dispatch = await runDispatch({ now });
  } catch (err) {
    dispatchFailed = true;
    failures.push('Dispatch');
    console.error('[cron/dispatch] Dispatch failed:', err);
  }

  // WhatsApp medicine reminders (Remind plan) run even when calling is down.
  const reminders = await step('WhatsApp reminders', () => runReminders({ now }));
  const summaries = await step('Summaries', () => runDigests({ now }));
  const lifecycle = await step('Lifecycle emails', () => runLifecycleEmails());

  const minutes = istMinutesOfDay(now);
  const daily = minutes >= DAILY_JOBS_FROM_MINUTES && minutes < DAILY_JOBS_FROM_MINUTES + DAILY_JOBS_WINDOW_MINUTES
    ? {
        insights: await step('Insights', () => runInsightsForAll({ now })),
        transcripts: await step('Transcript clean-up', () => clearOldTranscripts({ now }))
      }
    : null;

  await Promise.all([recordRun(now, failures), heartbeat(dispatchFailed || !dispatch || failures.length > 0)]);
  if (dispatchFailed || !dispatch) {
    return NextResponse.json({ error: 'Dispatch failed', reminders, escalations, summaries, lifecycle, daily }, { status: 500 });
  }
  return NextResponse.json({ success: true, ...dispatch, reminders, escalations, summaries, lifecycle, daily });
}

export const GET = handle;
export const POST = handle;
