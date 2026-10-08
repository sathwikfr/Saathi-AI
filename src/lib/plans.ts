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
// TODO(add-on): until the add-on is billed (Razorpay add-on on the subscription), `weeklyChat` is false on every plan,
// so the weekly chat is not offered and not dispatched.

/**
 * Pricing rationale (reset 2026-10-04, kept as low as the cost allows; GST not included).
 * **3 calls a day is a product requirement** on calling plans, so cost is cut elsewhere: optional extras ride only on the
 * day's first answered call, the health question rotates (one a day), and a missed call is retried once.
 * Sarvam: ₹4.90 per started minute incl. telephony; ~1.2 billed minutes per call assumed (check real durationSeconds),
 * +8% retries. Per parent a month at 3 calls a day ≈ ₹571 calls + ₹40 follow-ups / call-backs / emergency calls.
 * WhatsApp utility message ≈ ₹0.13 in India (foreign numbers cost much more, so people abroad default to
 * "problems + one daily summary"). "Ask about your parent" ≈ ₹6 a question (Sonnet 5.5), capped per plan.
 * Doctor / lab visit reminders are in every calling plan (2026-10-05); the rest of the extras are Family / Extended.
 * Busy month (every Ask question used, family in India), after the ~2.4% payment fee:
 *   Remind   ₹149:   WhatsApp only; worst case (never answers: 3 asks a dose + 2 caretaker alerts a day) ≈ ₹63 -> ≥ ₹82 left
 *   Solo     ₹999:   1 parent, 1 WhatsApp person, 15 Ask   ≈ ₹740   -> ≈ ₹235 left
 *   Family   ₹1,999: 2 parents, 2 WhatsApp people, 30 Ask ≈ ₹1,450 -> ≈ ₹500 left (couple on one phone ≈ ₹950)
 *   Extended ₹4,999: 5 parents, 5 WhatsApp people, 50 Ask ≈ ₹3,590 -> ≈ ₹1,290 left
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
    priceMonthly: 149,
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
    razorpayPlanId: 'plan_carecircle_essential_149',
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
    priceMonthly: 999,
    currency: '₹',
    hasTrial: true,
    trialDays: 7,
    parentsIncluded: 1,
    channel: 'call',
    callsPerDay: 3,
    remindersPerDay: 0,
    weeklyChat: false,
    askPerMonth: 15,
    whatsappPeople: 1,
    premium: false,
    razorpayPlanId: 'plan_carecircle_solo_999',
    features: [
      '1 parent or elder relative',
      '3 check-in calls a day, timed to their medicines, in 9 Indian languages',
      'A missed call is tried once more, then you are told',
      'How they are feeling every day; sleep, food and pain in turn',
      'Doctor and lab visit reminders, then "how did it go?"',
      'Emergency alerts to your family and local contacts, emergency card',
      'WhatsApp updates for 1 family member',
      '15 questions a month to Ask about your parent'
    ]
  },
  family: {
    id: 'family',
    name: 'Family Care',
    tagline: 'Everything for both parents, and updates for two of you',
    priceMonthly: 1999,
    currency: '₹',
    hasTrial: true,
    trialDays: 7,
    popular: true,
    parentsIncluded: 2,
    channel: 'call',
    callsPerDay: 3,
    remindersPerDay: 0,
    weeklyChat: false,
    askPerMonth: 30,
    whatsappPeople: 2,
    premium: true,
    razorpayPlanId: 'plan_carecircle_family_1999',
    features: [
      'Up to 2 parents (one call for both if they share a phone)',
      'Everything in Solo Care, 3 calls a day each',
      'WhatsApp updates for 2 family members, e.g. one in the US, one in the UK',
      'BP and sugar readings by voice, with a chart',
      'Health trends and family messages read out by Saathi',
      'Festivals, birthdays, weather, helper check, timeline and life stories',
      '30 questions a month to Ask about your parents'
    ]
  },
  extended: {
    id: 'extended',
    name: 'Extended Family',
    tagline: 'For larger families caring for several elders',
    priceMonthly: 4999,
    currency: '₹',
    hasTrial: true,
    trialDays: 7,
    parentsIncluded: 5,
    channel: 'call',
    callsPerDay: 3,
    remindersPerDay: 0,
    weeklyChat: false,
    askPerMonth: 50,
    whatsappPeople: 5,
    premium: true,
    razorpayPlanId: 'plan_carecircle_extended_4999',
    features: [
      'Up to 5 parents or elder relatives',
      'Everything in Family Care, 3 calls a day each',
      'WhatsApp updates for 5 family members',
      '50 questions a month to Ask about your parents',
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
