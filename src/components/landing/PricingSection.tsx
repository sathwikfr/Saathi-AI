import React from 'react';
import Link from 'next/link';
import { Check, Users, PhoneCall, Sparkles, BadgeIndianRupee, MessageCircle } from 'lucide-react';
import { Reveal } from '@/components/Reveal';
import { WordReveal } from '@/components/motion/WordReveal';
import { PLANS, PAID_PLAN_IDS, FREE_TRIAL_DAYS, HEALTH_MONITOR, healthMonitorPrice, healthMonitorListPrice } from '@/lib/plans';
import { PlanId } from '@/lib/types';
import s from './home.module.css';
import x from './pricing.module.css';

/**
 * Plans. Each card leads with what differs between plans (how many parents,
 * calls a day, a rough daily cost); what every plan shares is listed once
 * under the cards instead of being repeated three times. Prices, limits and
 * trial lengths all come from lib/plans.ts.
 */

const PAID: PlanId[] = PAID_PLAN_IDS;

/** What every calling plan includes (shown once, under the cards). Remind is WhatsApp-only, so it says so on its card. */
const EVERY_PLAN = [
  'Works on any phone, even a landline',
  '9 Indian languages',
  'A missed call is tried once more, then you are told',
  'Emergency alerts to family and neighbours',
  'Pause anytime (travel, hospital stay)',
  'Cancel anytime',
];

/** Rough cost of a day: per parent when the plan covers several. */
function perDay(id: PlanId) {
  const p = PLANS[id];
  const day = Math.max(1, Math.round(p.priceMonthly / 30 / p.parentsIncluded));
  return p.parentsIncluded > 1 ? `From ₹${day} a day per parent` : `About ₹${day} a day`;
}

export function PricingSection({ planHref }: { planHref: (id: PlanId) => string }) {
  return (
    <section id="plans" className="section">
      <div className="wrap">
        <Reveal className={s.head}>
          <span className={s.pill}><BadgeIndianRupee size={14} /> Pricing</span>
          <WordReveal>Simple plans. <span className={s.grad}>Cancel anytime.</span></WordReveal>
          <p>Every plan starts with {FREE_TRIAL_DAYS} days free. Set up AutoPay to begin; nothing is charged until the trial ends, and you can cancel any time.</p>
        </Reveal>

        <div className={x.plans}>
          {PAID.map((id, i) => {
            const plan = PLANS[id];
            const featured = !!plan.popular;
            const many = plan.parentsIncluded > 1;
            return (
              <Reveal key={id} delay={i * 100} className={`${x.plan} ${featured ? x.featured : ''}`}>
                {featured && <span className={x.badge}><Sparkles size={12} /> Most popular</span>}
                <h3>{plan.name}</h3>
                <p className={x.tagline}>{plan.tagline}</p>

                <div className={x.price}>
                  {plan.listPrice && <s aria-label={`was ₹${plan.listPrice}`}>₹{plan.listPrice.toLocaleString('en-IN')}</s>}
                  <b>₹{plan.priceMonthly.toLocaleString('en-IN')}</b>
                  <span>/ month</span>
                </div>
                <p className={x.perDay}>{plan.listPrice ? 'Launch offer · ' : ''}{perDay(id)}</p>

                <ul className={x.facts}>
                  {plan.channel === 'whatsapp' ? (
                    <>
                      <li><span className={x.factIcon}><Users size={15} /></span>For yourself, or someone in your family</li>
                      <li><span className={x.factIcon}><MessageCircle size={15} /></span>&ldquo;Did you take it?&rdquo; on WhatsApp at up to {plan.remindersPerDay} medicine times a day, no calls</li>
                      <li><span className={x.factIcon}><Check size={15} /></span>Asked up to 3 times; an optional caretaker is told. No spam</li>
                    </>
                  ) : (
                    <>
                      <li><span className={x.factIcon}><Users size={15} /></span>{many ? `Up to ${plan.parentsIncluded} parents` : '1 parent'}</li>
                      <li><span className={x.factIcon}><PhoneCall size={15} /></span>{plan.callsPerDay} calls a day{many ? ' each' : ''}</li>
                      <li><span className={x.factIcon}><MessageCircle size={15} /></span>WhatsApp updates for {plan.whatsappPeople} family member{plan.whatsappPeople === 1 ? '' : 's'}</li>
                      <li><span className={x.factIcon}><Sparkles size={15} /></span><span>Ask anything about their week, in plain words <span style={{ color: 'var(--ink-muted)', fontSize: '0.85em' }}>({plan.askPerMonth} a month)</span></span></li>
                      {plan.premium
                        ? <li><span className={x.factIcon}><Check size={15} /></span>Timeline of the days, and a summary for the doctor</li>
                        : <li><span className={x.factIcon}><Check size={15} /></span>Doctor and lab visit reminders</li>}
                      {plan.id === 'extended' && <li><span className={x.factIcon}><Check size={15} /></span>Priority support</li>}
                      <li><span className={x.factIcon}><Check size={15} /></span>Optional: {HEALTH_MONITOR.name} (how they feel, BP, sugar, trends) +{healthMonitorListPrice(plan.id) ? <><s className="was-price">₹{healthMonitorListPrice(plan.id)}</s>₹{healthMonitorPrice(plan.id)}</> : `₹${healthMonitorPrice(plan.id)}`}</li>
                    </>
                  )}
                </ul>

                <Link href={planHref(id)} className={`btn btn-block ${featured ? 'btn-primary btn-glow' : 'btn-ghost'} ${x.cta}`}>
                  Start {plan.trialDays}-day free trial
                </Link>
              </Reveal>
            );
          })}
        </div>

        <Reveal className={x.every}>
          <span className={x.everyTitle}>Every calling plan includes</span>
          <ul>
            {EVERY_PLAN.map((f) => (
              <li key={f}><Check size={15} strokeWidth={2.5} /> {f}</li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
