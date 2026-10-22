import React from 'react';
import Link from 'next/link';
import { Check, Sparkles, HeartPulse, Users } from 'lucide-react';
import { Reveal } from '@/components/Reveal';
import { WordReveal } from '@/components/motion/WordReveal';
import { CountUp } from '@/components/motion/CountUp';
import { PLANS, FREE_TRIAL_DAYS, HEALTH_MONITOR, healthMonitorPrice } from '@/lib/plans';
import { PlanId } from '@/lib/types';
import s from './home.module.css';
import x from './pricing.module.css';

/**
 * Plans. Two cards only (2026-10-22, launch focus): Remind (WhatsApp) and Solo (calls).
 * Family and Extended are still sold; they sit in one line under the cards for
 * people looking after more than one parent. What every calling plan shares is
 * listed once under the cards. Prices, limits and trial lengths all come from lib/plans.ts.
 */

const SHOWN: PlanId[] = ['essential', 'solo'];
const FEATURED: PlanId = 'solo';
const MORE_PARENTS: PlanId[] = ['family', 'extended'];

/** What every calling plan includes (shown once, under the cards). Remind is WhatsApp-only, so it says so on its card. */
const EVERY_PLAN = [
  'Works on any phone, even a landline',
  '9 Indian languages',
  'If Saathi can’t reach them, we try once more, then tell you',
  'Emergency alerts to family and neighbours',
  'Doctor and lab visit reminders',
  'Pause anytime (travel, hospital stay)',
  'Cancel anytime',
];

/** Rough cost of a day: per parent when the plan covers several. */
function perDay(id: PlanId) {
  const p = PLANS[id];
  const day = Math.max(1, Math.round(p.priceMonthly / 30 / p.parentsIncluded));
  return p.parentsIncluded > 1 ? `₹${day} a day each` : `₹${day} a day`;
}

/** The few lines that differ between plans; everything shared is listed once under the cards. */
function factsFor(id: PlanId): string[] {
  const p = PLANS[id];
  if (p.channel === 'whatsapp') {
    return [`WhatsApp check at each medicine time (no calls), up to ${p.remindersPerDay} a day`, 'Asked again if there is no reply', 'Optional caretaker told when one is missed'];
  }
  const many = p.parentsIncluded > 1;
  return [
    many ? `Up to ${p.parentsIncluded} parents` : '1 parent',
    `${p.callsPerDay} calls a day${many ? ' each' : ''}`,
    `WhatsApp updates for ${p.whatsappPeople} ${p.whatsappPeople === 1 ? 'person' : 'people'}`,
    p.premium ? `Ask ${p.askPerMonth} questions a month, timeline, doctor summary` : `Ask questions about their week (${p.askPerMonth} a month)`,
    ...(id === 'extended' ? ['Priority support'] : [])
  ];
}

export function PricingSection({ planHref }: { planHref: (id: PlanId) => string }) {
  return (
    <section id="plans" className="section">
      <div className="wrap">
        <Reveal className={s.head}>
          <WordReveal>Simple plans. <span className={s.grad}>Cancel anytime.</span></WordReveal>
          <p>Every plan starts with {FREE_TRIAL_DAYS} days free. Set up AutoPay to begin; nothing is charged until the trial ends, and you can cancel any time.</p>
        </Reveal>

        <div className={x.plans}>
          {SHOWN.map((id, i) => {
            const plan = PLANS[id];
            const featured = id === FEATURED;
            return (
              <Reveal key={id} delay={i * 100} className={`${x.plan} ${featured ? x.featured : ''}`} data-spot>
                {featured && <span className={x.badge}><Sparkles size={12} /> Most popular</span>}
                <h3>{plan.name}</h3>
                <p className={x.tagline}>{plan.tagline}</p>

                <div className={x.price}>
                  <b>₹<CountUp value={plan.priceMonthly} duration={1300} /></b>
                  <span>/month</span>
                </div>
                <p className={x.perDay}>
                  {plan.listPrice && <><s aria-label={`was ₹${plan.listPrice}`}>₹{plan.listPrice.toLocaleString('en-IN')}</s> · </>}
                  {perDay(id)}
                </p>

                <ul className={x.facts}>
                  {factsFor(id).map(f => <li key={f}><Check size={15} strokeWidth={2.5} />{f}</li>)}
                </ul>
                {plan.channel === 'whatsapp' && <Link href="/#remind" className={x.more}>See how the WhatsApp reminders work</Link>}

                <Link href={planHref(id)} className={`btn btn-block ${featured ? 'btn-primary btn-glow' : 'btn-ghost'} ${x.cta}`}>
                  Start {plan.trialDays}-day free trial
                </Link>
              </Reveal>
            );
          })}
        </div>

        <Reveal className={x.addon}>
          <span className={x.addonIcon}><Users size={20} /></span>
          <div>
            <strong>Looking after more than one parent?</strong>
            <p>The same calls for each parent, with WhatsApp updates for more of the family.</p>
          </div>
          <span className={x.addonPrice}>
            {MORE_PARENTS.map((id, i) => (
              <React.Fragment key={id}>
                {i > 0 && ' · '}
                <Link href={planHref(id)}>
                  {PLANS[id].name}: {PLANS[id].parentsIncluded === 2 ? '2 parents' : `up to ${PLANS[id].parentsIncluded}`}, ₹{PLANS[id].priceMonthly.toLocaleString('en-IN')}
                </Link>
              </React.Fragment>
            ))}
          </span>
        </Reveal>

        <Reveal className={x.addon}>
          <span className={x.addonIcon}><HeartPulse size={20} /></span>
          <div>
            <strong>Add {HEALTH_MONITOR.name} to any calling plan</strong>
            <p>How they feel each day, BP and sugar by voice, and trends against their usual.</p>
          </div>
          <span className={x.addonPrice}>+₹{healthMonitorPrice('solo')} Solo · ₹{healthMonitorPrice('family')} Family · ₹{healthMonitorPrice('extended')} Extended</span>
        </Reveal>

        <Reveal className={x.every}>
          <span className={x.everyTitle}>Every calling plan includes</span>
          <ul data-stagger>
            {EVERY_PLAN.map((f) => (
              <li key={f}><Check size={15} strokeWidth={2.5} /> {f}</li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
