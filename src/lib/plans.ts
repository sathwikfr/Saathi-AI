import { Plan, PlanId } from './types';

export const FREE_TRIAL_DAYS = 7;
const DAY_MS = 86400000;

/** Paid plans, cheapest first (checkout, landing cards, Razorpay plan ids). */
export const PAID_PLAN_IDS: PlanId[] = ['essential', 'solo', 'family', 'extended'];

/**
 * Weekly chat (companion call) add-on, per parent per month. Not bundled since 2026-10-04:
 * a 5-minute chat each week costs ~₹105 a month at Sarvam rates.
 */
export const COMPANION_ADDON_PRICE = 199;

/**
 * Add-ons (2026-10-08), picked at checkout on any calling plan (Solo, Family, Extended):
 *  - Health Monitor: BP and sugar by voice, the chart, the family's limits and alerts, health trends against the parent's
 *    own normal, and ONE short extra call a day per parent just for the readings (outside the 3-call cap, so the medicine
 *    calls stay under a minute). Priced by how many parents the plan holds.
 * (Daily Touches, ₹99 for festival wishes, weather notes and the helper check, was removed on 2026-10-08: little value
 * for one more choice at checkout.)
 * A Razorpay plan is a fixed amount and its add-ons are one-time charges, so each combination is its own plan
 * (RAZORPAY_PLAN_ID_<PLAN>[_MONITOR]; scripts/create-razorpay-plans.ts creates them all).
 */
export const HEALTH_MONITOR = {
  id: 'health_monitor',
  name: 'Health Monitor',
  /** Solo (1 parent) / Family (2) / Extended (5): about ₹150 of calls per parent, so cheaper per parent on the bigger plans. */
  priceByPlan: { solo: 249, family: 499, extended: 999 } as Partial<Record<PlanId, number>>,
  /** Shown struck through next to the price (launch offer). */
  listPriceByPlan: { solo: 299 } as Partial<Record<PlanId, number>>,
  tagline: 'How they feel each day, BP and sugar by voice, with charts, alerts and health trends',
  features: [
    'How they are feeling every day; sleep, food and pain in turn',
    "A weekly check that their tablets won't run out",
    'Saathi asks for BP and sugar every day or every 3 days (you choose), on a short call of its own',
    'A chart for you and the doctor, and your own limits',
    'An alert when a reading is out of range or at a level doctors treat as urgent',
    "Health trends: you are told when sleep, mood or appetite drift from their usual",
    'Saathi never comments on the numbers'
  ]
};

export interface Addons {
  healthMonitor: boolean;
}
export const NO_ADDONS: Addons = { healthMonitor: false };

/** Add-ons are for the calling plans (Remind has no calls, Free has no paid period). */
export function healthMonitorAvailable(planId: PlanId): boolean {
  return HEALTH_MONITOR.priceByPlan[planId] !== undefined;
}

export function healthMonitorPrice(planId: PlanId): number {
  return HEALTH_MONITOR.priceByPlan[planId] ?? 0;
}

/** The struck-through "was" price of the Health Monitor on this plan, if there is one. */
export function healthMonitorListPrice(planId: PlanId): number | undefined {
  return HEALTH_MONITOR.listPriceByPlan[planId];
}

/**
 * Family and Extended (user, 2026-10-08): a call must not run to 2 minutes. About 90 seconds in, Saathi says it will tell
 * the family and ends the call (sent to the agent as `firm_time_limit`; the agent's own maximum is the hard stop).
 * Solo keeps the gentle rule: Saathi never cuts a parent off.
 */
export function firmCallLimit(planId: PlanId): boolean {
  return planId === 'family' || planId === 'extended';
}

/** Drops the add-ons a plan doesn't offer. */
export function cleanAddons(planId: PlanId, input: Partial<Addons> | null | undefined): Addons {
  return {
    healthMonitor: !!input?.healthMonitor && healthMonitorAvailable(planId)
  };
}

/**
 * Changing plan (or adding Health Monitor) while a paid period is still running: the new plan's FIRST CHARGE waits for the
 * end of that period (like a free trial does), so the customer is not charged twice for the same days. The new plan and its
 * features apply at once. Returns where the old period ends, or null when there is nothing to carry over (first plan, a
 * cancelled or failing subscription, or under a day left).
 */
export interface CarriedPeriod {
  periodEnd: Date;
  status: 'active' | 'trialing';
  trialEndsAt: Date | null;
}

export function carriedPeriod(
  sub: { planId: PlanId; status: string; currentPeriodEnd: string; trialEndsAt?: string; cancelAtPeriodEnd: boolean; razorpaySubscriptionId?: string } | null | undefined,
  now: Date = new Date()
): CarriedPeriod | null {
  if (!sub || !sub.razorpaySubscriptionId || sub.cancelAtPeriodEnd) return null;
  if (!PLANS[sub.planId] || PLANS[sub.planId].priceMonthly === 0) return null;
  if (sub.status !== 'active' && sub.status !== 'trialing') return null;
  const end = new Date(sub.currentPeriodEnd);
  if (Number.isNaN(end.getTime()) || end.getTime() - now.getTime() < 86400000) return null;
  return {
    periodEnd: end,
    status: sub.status,
    trialEndsAt: sub.status === 'trialing' && sub.trialEndsAt ? new Date(sub.trialEndsAt) : sub.status === 'trialing' ? end : null
  };
}

/** What the customer pays each month: the plan plus the add-ons (only where they are offered). */
export function monthlyPrice(planId: PlanId, healthMonitor: boolean | Partial<Addons>): number {
  const add = cleanAddons(planId, typeof healthMonitor === 'object' ? healthMonitor : { healthMonitor });
  return PLANS[planId].priceMonthly + (add.healthMonitor ? healthMonitorPrice(planId) : 0);
}
// TODO(add-on): until the add-on is billed (Razorpay add-on on the subscription), `weeklyChat` is false on every plan,
// so the weekly chat is not offered and not dispatched.

/**
 * Pricing rationale (reset 2026-10-04, lowered 2026-10-08 with the old price shown struck through as a launch offer:
 * Remind 149 -> 99, Solo 999 -> 899, Family 1,999 -> 1,699, Extended 4,999 -> 3,999, Health Monitor Solo 299 -> 249;
 * kept as low as the cost allows; GST not included).
 * **3 calls a day is a product requirement** on calling plans, so cost is cut elsewhere: the health questions ride on ONE
 * call a day (the earliest that fits in about a minute, callPlanning.chooseHealthSlot), the health question rotates
 * (one a day), a missed call is retried once (30 minutes later) and there are no extra "you said later" calls.
 * Sarvam: ₹4.90 per started minute incl. telephony, so a call that stays under 60 seconds bills 1 minute. On Solo Saathi
 * never cuts a parent off; on Family / Extended it wraps up about 90 s in (firmCallLimit), so a call never bills 3 minutes.
 * Every call at 2 billed minutes would still be a loss on every calling plan: the real guard is the ~56 s plan per call. Per parent a month at 3 calls a day: ≈ ₹441 calls at 1 billed minute each (+8% retries), ≈ ₹660 at
 * 1.5 minutes each (check real durationSeconds: /admin shows the average), + ≈ ₹20 call-backs / emergency calls.
 * WhatsApp utility message ≈ ₹0.13 in India (foreign numbers cost much more, so people abroad default to
 * "problems + one daily summary"). "Ask about your parent" ≈ ₹6 a question (Sonnet 5.5), capped per plan.
 * Doctor / lab visit reminders are in every calling plan (2026-10-05); the rest of the extras are Family / Extended.
 * Busy month (every Ask question used, family in India), after the ~2.4% payment fee:
 *   Remind   ₹99:    WhatsApp only; worst case (never answers: 3 asks a dose + 2 caretaker alerts a day) ≈ ₹63 -> ≥ ₹33 left
 *   Solo     ₹899:   1 parent, 1 WhatsApp person, 10 Ask   ≈ ₹590 (calls ~1 min) -> ≈ ₹310 left; ≈ ₹830 (1.5 min) -> ≈ ₹70 left
 *   Family   ₹1,699: 2 parents, 2 WhatsApp people, 20 Ask  ≈ ₹1,150 (calls ~1 min) -> ≈ ₹500 left (≈ ₹30 at 1.5 min a call)
 *            = ₹99 less than two Solo plans, with one dashboard, 2 WhatsApp people, the timeline and the couple call.
 *   Extended ₹3,999: 5 parents, 5 WhatsApp people, 30 Ask  ≈ ₹2,840 (calls ~1 min) -> ≈ ₹1,160 left (≈ break-even at 1.5 min a call)
 *            = ₹800 a parent: Solo ₹899, Family ₹850, Extended ₹800.
 * Add-ons (any calling plan; each is its own Razorpay plan, see HEALTH_MONITOR):
 *   Health Monitor: Solo ₹249, Family ₹499, Extended ₹999: one short readings call a day per parent ≈ ₹160 each (1 billed
 *   minute) -> Solo ≈ ₹80 left; a readings call that runs 2 minutes every day loses money, so it has no room for chat.
 * Weekly chat is a ₹199 add-on, not bundled. Changing a price needs a new Razorpay plan
 * (RAZORPAY_PLAN_ID_ESSENTIAL [= Remind] / _SOLO / _FAMILY / _EXTENDED).
 */
export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free Trial',
    // Since 2026-10-03 a parent can only be added on a paid plan (its 7-day trial needs AutoPay set up
    // first). Accounts that already added a parent on this plan keep their calls until day 7.
    tagline: `Choose a plan to start your ${FREE_TRIAL_DAYS}-day free trial`,
    priceMonthly: 0,
    currency: '₹',
    hasTrial: false,
    trialDays: 0,
    parentsIncluded: 1,
    channel: 'call',
    callsPerDay: 1,
    remindersPerDay: 0,
    weeklyChat: false,
    askPerMonth: 5,
    whatsappPeople: 1,
    premium: false,
    expiresAfterDays: FREE_TRIAL_DAYS,
    features: [
      '1 parent',
      `1 check-in call a day for ${FREE_TRIAL_DAYS} days`,
      'Medicine confirmation on every call',
      'Call history on your dashboard',
      'Works on any phone, no app needed'
    ]
  },
  // Internal id stays `essential` (Razorpay env RAZORPAY_PLAN_ID_ESSENTIAL, existing subscription rows); shown as "Remind".
  essential: {
    id: 'essential',
    name: 'Remind',
    tagline: 'WhatsApp medicine reminders for yourself or someone you care about. No calls, no spam',
    priceMonthly: 99,
    listPrice: 149,
    currency: '₹',
    hasTrial: true,
    trialDays: 7,
    parentsIncluded: 1,
    channel: 'whatsapp',
    callsPerDay: 0,
    remindersPerDay: 4,
    weeklyChat: false,
    askPerMonth: 0,
    whatsappPeople: 0,
    premium: false,
    razorpayPlanId: 'plan_carecircle_essential_99',
    features: [
      'For yourself, or someone in your family',
      'WhatsApp "did you take it?" at each medicine time (up to 4 a day), no calls',
      'Yes / Not yet buttons; asked again every 30 minutes, up to 3 times',
      'Optional caretaker (husband, parent): told only when needed',
      'No spam: we only message when it is needed',
      'Course end dates and discreet mode (no medicine names on the lock screen)',
      'Taken and missed history on your dashboard'
    ]
  },
  solo: {
    id: 'solo',
    name: 'Solo Care',
    tagline: 'Check-in calls for one parent, timed to their medicines',
    priceMonthly: 899,
    listPrice: 999,
    currency: '₹',
    hasTrial: true,
    trialDays: 7,
    parentsIncluded: 1,
    channel: 'call',
    callsPerDay: 3,
    remindersPerDay: 0,
    weeklyChat: false,
    askPerMonth: 10,
    whatsappPeople: 1,
    premium: false,
    razorpayPlanId: 'plan_carecircle_solo_899',
    features: [
      '1 parent or elder relative',
      '3 check-in calls a day, timed to their medicines, in 9 Indian languages',
      'A missed call is tried once more, then you are told',
      'Doctor and lab visit reminders, then "how did it go?"',
      'Emergency alerts to your family and local contacts, emergency card',
      'WhatsApp updates for 1 family member',
      'Ask anything about their week, in plain words (10 a month)'
    ]
  },
  family: {
    id: 'family',
    name: 'Family Care',
    tagline: 'Everything for both parents, and updates for two of you',
    priceMonthly: 1699,
    listPrice: 1999,
    currency: '₹',
    hasTrial: true,
    trialDays: 7,
    popular: true,
    parentsIncluded: 2,
    channel: 'call',
    callsPerDay: 3,
    remindersPerDay: 0,
    weeklyChat: false,
    askPerMonth: 20,
    whatsappPeople: 2,
    premium: true,
    razorpayPlanId: 'plan_carecircle_family_1699',
    features: [
      'Up to 2 parents (one call for both if they share a phone)',
      'Everything in Solo Care, 3 calls a day each',
      'WhatsApp updates for 2 family members, e.g. one in the US, one in the UK',
      'A timeline of the days, calls and alerts, and a summary for the doctor',
      'Ask anything about their week, in plain words (20 a month)'
    ]
  },
  extended: {
    id: 'extended',
    name: 'Extended Family',
    tagline: 'For larger families caring for several elders',
    priceMonthly: 3999,
    listPrice: 4999,
    currency: '₹',
    hasTrial: true,
    trialDays: 7,
    parentsIncluded: 5,
    channel: 'call',
    callsPerDay: 3,
    remindersPerDay: 0,
    weeklyChat: false,
    askPerMonth: 30,
    whatsappPeople: 5,
    premium: true,
    razorpayPlanId: 'plan_carecircle_extended_3999',
    features: [
      'Up to 5 parents or elder relatives',
      'Everything in Family Care, 3 calls a day each',
      'WhatsApp updates for 5 family members',
      'Ask anything about their week, in plain words (30 a month)',
      'Priority support'
    ]
  }
};

export function getPlan(planId: string | null | undefined): Plan {
  if (planId && Object.prototype.hasOwnProperty.call(PLANS, planId)) return PLANS[planId as PlanId];
  return PLANS.family; // Default to popular plan
}

/**
 * Adding a parent needs payment details on file: a paid plan (trialing counts, its AutoPay is set up).
 * Free / ended-trial accounts are sent to checkout first.
 */
export function canAddParents(plan: Plan): boolean {
  return plan.priceMonthly > 0 && !plan.expired;
}

/** Cheapest calling plan that covers this many parents (null when none does). WhatsApp-only Remind is never suggested as an upgrade. */
export function smallestPlanFor(parentCount: number): Plan | null {
  return PAID_PLAN_IDS.map(id => PLANS[id]).find(p => p.channel === 'call' && p.parentsIncluded >= parentCount) || null;
}

/**
 * How this person's medicine reminders go out: a WhatsApp-only plan always means WhatsApp;
 * on a calling plan the person's own setting decides (people set up on Remind stay on WhatsApp until switched).
 */
export function reminderChannelFor(plan: Pick<Plan, 'channel'>, parent: { reminderChannel?: string | null }): 'call' | 'whatsapp' {
  if (plan.channel === 'whatsapp') return 'whatsapp';
  return parent.reminderChannel === 'whatsapp' ? 'whatsapp' : 'call';
}

/** When an account's free trial ends: FREE_TRIAL_DAYS after the account was created (it can't be restarted). */
export function freeTrialEnd(accountCreatedAt: string | Date): Date {
  return new Date(new Date(accountCreatedAt).getTime() + FREE_TRIAL_DAYS * DAY_MS);
}

/** Whole days left in the free trial (0 when over or when the date is unknown). */
export function freeTrialDaysLeft(accountCreatedAt: string | Date | undefined, now: Date = new Date()): number {
  if (!accountCreatedAt) return 0;
  return Math.max(0, Math.ceil((freeTrialEnd(accountCreatedAt).getTime() - now.getTime()) / DAY_MS));
}

function expiredFreePlan(): Plan {
  return {
    ...PLANS.free,
    name: 'Free trial ended',
    tagline: 'Choose a plan to restart the daily check-in calls',
    callsPerDay: 0,
    expired: true
  };
}

function freeTierPlan(accountCreatedAt: string | Date | undefined, now: Date): Plan {
  if (accountCreatedAt && now.getTime() > freeTrialEnd(accountCreatedAt).getTime()) return expiredFreePlan();
  return PLANS.free;
}

/** Days a paid plan keeps working after its period ended, while a renewal charge is still being confirmed. */
export const PAID_GRACE_DAYS = 3;

/**
 * The plan whose limits apply right now.
 *  - Free is a 7-day trial from account creation; afterwards no calls are placed (`expired`).
 *  - Cancelled subscriptions whose paid period has ended fall back to the free tier (usually expired).
 * Pass the account's createdAt so the trial window is known.
 */
export function getEffectivePlan(
  subscription?: { planId: PlanId; status: string; currentPeriodEnd: string } | null,
  accountCreatedAt?: string | Date,
  now: Date = new Date()
): Plan {
  if (!subscription) return freeTierPlan(accountCreatedAt, now);
  const periodOver = new Date(subscription.currentPeriodEnd).getTime() < now.getTime();
  if (subscription.planId === 'free') {
    return periodOver ? expiredFreePlan() : freeTierPlan(accountCreatedAt, now);
  }
  if (subscription.status === 'cancelled' && periodOver) return freeTierPlan(accountCreatedAt, now);
  // Fail closed: a paid plan lives only while its period is current. Every Razorpay charge moves currentPeriodEnd
  // forward, so a period that ended more than the grace days ago means no charge arrived (payment failed, or its
  // webhook never reached us) and the plan must not run on for free.
  if (subscription.status !== 'cancelled' && new Date(subscription.currentPeriodEnd).getTime() + PAID_GRACE_DAYS * 86400000 < now.getTime()) {
    return freeTierPlan(accountCreatedAt, now);
  }
  return PLANS[subscription.planId] || freeTierPlan(accountCreatedAt, now);
}
