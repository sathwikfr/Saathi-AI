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

/** Daily jobs run in the first cron tick(s) after 9:30 PM IST; running twice is harmless (unique keys). */
const DAILY_JOBS_FROM_MINUTES = 21 * 60 + 30;
const DAILY_JOBS_WINDOW_MINUTES = 10;

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
async function step<T>(name: string, fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[cron/dispatch] ${name} failed:`, err);
    return { error: `${name} failed` };
  }
}

async function handle(req: Request) {
  if (!safeEqual(requestSecret(req, 'x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  // An emergency that is already being worked on comes first: placing a morning's worth of calls can be slow,
  // and if this run is cut off the next round of phone calls must not be the thing that is left undone.
  const escalations = await step('Escalations', () => advanceEscalations({ now }));
  let dispatch: Awaited<ReturnType<typeof runDispatch>> | null = null;
  let dispatchFailed = false;
  try {
    dispatch = await runDispatch({ now });
  } catch (err) {
    dispatchFailed = true;
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

  if (dispatchFailed || !dispatch) {
    return NextResponse.json({ error: 'Dispatch failed', reminders, escalations, summaries, lifecycle, daily }, { status: 500 });
  }
  return NextResponse.json({ success: true, ...dispatch, reminders, escalations, summaries, lifecycle, daily });
}

export const GET = handle;
export const POST = handle;
