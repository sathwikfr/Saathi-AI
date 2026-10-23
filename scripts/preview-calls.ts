/**
 * Who would Saathi call once the scheduler (cron-job.org -> /api/cron/dispatch) is switched on?
 * READ-ONLY: it reads the database and prints; it places no call, sends nothing and changes no row.
 *
 *   npx tsx scripts/preview-calls.ts
 *
 * Same rules as runDispatch() in src/lib/callDispatch.ts: removed parents and parents who said no are never called,
 * paused ones wait for their date, an ended trial or lapsed plan stops calls, WhatsApp people get messages instead,
 * at most plan.callsPerDay medicine calls (+ the Health Monitor readings call), one call for a couple sharing a phone.
 * Not shown: the one retry 30 min after an unanswered call, and calls the family places by hand.
 * Keep it in step with runDispatch() when those rules change.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { getEffectivePlan, reminderChannelFor, healthMonitorAvailable } from '../src/lib/plans';
import { normalizePhone } from '../src/lib/phone';
import { istDateString, istMinutesOfDay, parseClockTime } from '../src/lib/ist';
import { consentBlocksCalls, isVitalsSlot, coupleOf } from '../src/lib/callDispatch';
import { PlanId } from '../src/lib/types';

const RUPEES_PER_CALL = 4.9; // one billed minute (lib/adminStats.ts)
const DAY = 86400000;

type Line = { account: string; parent: string; phone: string; status: string; today: string[]; tomorrow: string[] };

async function main() {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + DAY);
  const today = istDateString(now);
  const nowMinutes = istMinutesOfDay(now);

  const parents = await prisma.parentProfile.findMany({
    where: { isDeleted: false },
    include: { callSchedule: { where: { isActive: true } }, user: { include: { subscription: true } } },
    orderBy: [{ userId: 'asc' }, { createdAt: 'asc' }]
  });
  const byId = new Map(parents.map(p => [p.id, p]));
  const lines: Line[] = [];

  for (const p of parents) {
    const phone = normalizePhone(p.phone);
    const line: Line = {
      account: p.user.email,
      parent: p.name,
      phone: phone.ok ? `…${phone.e164.slice(-4)}` : '(invalid)',
      status: '',
      today: [],
      tomorrow: []
    };
    lines.push(line);
    const sub = p.user.subscription;
    const subArg = sub ? { planId: sub.planId as PlanId, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd.toISOString() } : null;
    const plan = getEffectivePlan(subArg, p.user.createdAt, now);
    const planTomorrow = getEffectivePlan(subArg, p.user.createdAt, tomorrow);

    if (!p.consentGiven) { line.status = 'NOT CALLED: family has not confirmed consent'; continue; }
    if (consentBlocksCalls(p.parentConsent)) { line.status = 'NOT CALLED: the parent said no to calls'; continue; }
    if (p.isPaused && !(p.pauseUntil && p.pauseUntil.getTime() <= now.getTime())) {
      line.status = p.pauseUntil ? `PAUSED until ${p.pauseUntil.toISOString().slice(0, 16).replace('T', ' ')} UTC, then calls start again` : 'PAUSED (no end date)';
      continue;
    }
    if (!phone.ok) { line.status = 'NOT CALLED: phone number is not valid'; continue; }
    if (plan.expired) { line.status = `NOT CALLED: ${plan.id === 'free' || !sub || sub.planId === 'free' ? 'free trial over' : 'plan lapsed'}`; continue; }
    if (reminderChannelFor(plan, p) === 'whatsapp') {
      const times = p.callSchedule.map(s => s.time).filter(t => parseClockTime(t) !== null);
      line.status = `WHATSAPP checks instead of calls (${p.reminderOptInAt ? 'opted in' : 'not opted in yet: nothing is sent'})`;
      line.tomorrow = times;
      continue;
    }

    const slots = [...p.callSchedule]
      .filter(s => parseClockTime(s.time) !== null)
      .sort((a, b) => (parseClockTime(a.time) as number) - (parseClockTime(b.time) as number));
    const hasMonitor = !!sub?.healthMonitor && healthMonitorAvailable(plan.id);
    const vitals = hasMonitor ? slots.find(isVitalsSlot) : undefined;
    const med = (vitals ? slots.filter(s => s.id !== vitals.id) : slots).slice(0, plan.callsPerDay);
    const capped = [...med, ...(vitals ? [vitals] : [])].sort((a, b) => (parseClockTime(a.time) as number) - (parseClockTime(b.time) as number));
    const couple = plan.premium ? coupleOf(p, byId) : null;
    const covered = couple && !couple.primary ? new Set(couple.partner.callSchedule.filter(s => s.isActive).map(s => s.slot)) : new Set<string>();
    const createdToday = istDateString(p.createdAt) === today;
    const createdMinutes = istMinutesOfDay(p.createdAt);

    const label = (s: typeof slots[number]) => `${s.time}${vitals && s.id === vitals.id ? ' (BP/sugar readings, only on days a reading is due)' : ''}`;
    const callable = capped.filter(s => !covered.has(s.slot));
    line.today = callable
      .filter(s => (parseClockTime(s.time) as number) > nowMinutes && !(createdToday && (parseClockTime(s.time) as number) <= createdMinutes))
      .map(label);
    line.tomorrow = planTomorrow.expired ? [] : callable.map(label);
    const skipped = slots.length - capped.length;
    line.status = callable.length === 0
      ? (covered.size ? 'NOT CALLED separately: joins the partner\'s call (same phone)' : 'NOT CALLED: no call times set')
      : `CALLED (${plan.name}${skipped > 0 ? `; ${skipped} extra time${skipped === 1 ? '' : 's'} over the ${plan.callsPerDay}-a-day cap skipped` : ''}${planTomorrow.expired ? '; plan ends before tomorrow' : ''})`;
  }

  const removed = await prisma.parentProfile.count({ where: { isDeleted: true } });
  console.log(`\nWho Saathi would call: ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC (IST date ${today})`);
  console.log('Read-only preview of the rules. Calls only go out once the live site has its Sarvam keys and the scheduler runs.\n');

  let account = '';
  for (const l of lines) {
    if (l.account !== account) { account = l.account; console.log(`■ ${account}`); }
    console.log(`  ${l.parent} (${l.phone}): ${l.status}`);
    if (l.today.length) console.log(`      rest of today: ${l.today.join(', ')}`);
    if (l.tomorrow.length) console.log(`      ${l.status.startsWith('WHATSAPP') ? 'message times' : 'tomorrow'}: ${l.tomorrow.join(', ')}`);
  }

  const called = lines.filter(l => l.status.startsWith('CALLED'));
  const todayCalls = called.reduce((n, l) => n + l.today.length, 0);
  const tomorrowCalls = called.reduce((n, l) => n + l.tomorrow.length, 0);
  console.log(`\nTotals: ${called.length} of ${lines.length} parents would be called.`);
  console.log(`  rest of today: ${todayCalls} calls · tomorrow: ${tomorrowCalls} calls (≈ ₹${Math.round(tomorrowCalls * RUPEES_PER_CALL)} a day, before retries)`);
  console.log(`  ${lines.filter(l => l.status.startsWith('WHATSAPP')).length} on WhatsApp checks · ${removed} removed parents are never called.`);
  console.log('\nTo stop a parent being called: Dashboard -> that parent -> Pause, or remove them. Nothing here changed anything.\n');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
