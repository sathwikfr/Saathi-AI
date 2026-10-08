import React from 'react';
import { Plus, Mail, MessageCircleQuestion } from 'lucide-react';
import { Reveal } from '@/components/Reveal';
import { PLANS, FREE_TRIAL_DAYS } from '@/lib/plans';
import s from './home.module.css';
import x from './faq.module.css';

/**
 * FAQ: the heading (and a way to write to us) on the left, the questions on
 * the right. Answers describe what the product really does (retries, alerts,
 * prices from lib/plans.ts).
 */

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

const FAQ = [
  { q: 'Does my parent need a smartphone or an app?', a: 'No. Saathi calls an ordinary phone number. If it rings and they can answer it, it works, including basic keypad phones and landlines.' },
  { q: 'Which languages does Saathi speak?', a: 'Hindi, English, Tamil, Telugu, Kannada, Bengali, Marathi, Gujarati and Malayalam. You pick the language when you add your parent, and you can change it later.' },
  { q: 'What does Saathi actually ask?', a: 'Each call is short. Saathi asks whether they have taken the medicines due at that time, asks one gentle question about how they are feeling, and passes on anything they want you to know.' },
  { q: 'What happens if they don’t pick up?', a: 'Saathi tries once more 30 minutes later. If that call isn’t answered either, you get an alert so you can check in yourself.' },
  { q: 'What does it cost after the free trial?', a: `${PLANS.essential.name}, the WhatsApp medicine check (no calls), is ${rupees(PLANS.essential.priceMonthly)} a month. Saathi's check-in calls start at ${rupees(PLANS.solo.priceMonthly)} a month for one parent, ${rupees(PLANS.family.priceMonthly)} for two and ${rupees(PLANS.extended.priceMonthly)} for up to ${PLANS.extended.parentsIncluded}. Every plan starts with a ${FREE_TRIAL_DAYS}-day free trial: you set up AutoPay first, nothing is charged until the trial ends, and you can cancel from your billing page at any time.` },
  { q: 'Can I use it for myself?', a: `Yes. ${PLANS.essential.name} (${rupees(PLANS.essential.priceMonthly)} a month) asks you, or someone in your family who always has their phone (a working mum-to-be, a student on a course of medicines), "did you take it?" on WhatsApp at each medicine time. Not yet or no reply: asked again every 30 minutes, up to 3 times. If you like, add a caretaker (husband, parent): they are told only when a dose isn't confirmed or something is urgent. It stops by itself when the course ends. No calls, and no spam: we only message when it is needed.` },
  { q: 'Can my brother abroad get the updates too?', a: `Yes. ${PLANS.solo.name} sends WhatsApp updates to ${PLANS.solo.whatsappPeople} family member, ${PLANS.family.name} to ${PLANS.family.whatsappPeople} (for example one of you in the US and one in the UK) and ${PLANS.extended.name} to ${PLANS.extended.whatsappPeople}. Family abroad get "only when something needs attention" plus one daily summary by default, and can change it. Urgent alerts always reach everyone who turned WhatsApp on.` },
  { q: 'Is Aaptha a medical or emergency service?', a: 'No. Aaptha is a family check-in companion. It does not replace a doctor, a caregiver or emergency services. In an emergency, call 112.' },
  { q: 'Can I pause the calls?', a: 'Yes. Pause them for a trip or a hospital stay, and they start again on the date you choose.' },
];

export function FaqSection() {
  const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  return (
    <section id="faq" className={`section ${s.alt}`}>
      <div className={`wrap ${x.grid}`}>
        <Reveal className={x.intro}>
          <span className={s.pill}><MessageCircleQuestion size={14} /> Questions</span>
          <h2 className={x.title}>What families <span className={s.grad}>usually ask.</span></h2>
          <p className={x.lead}>Short answers to what people ask before they start.</p>
          {email && (
            <a className={x.contact} href={`mailto:${email}`}>
              <span className={x.contactIcon}><Mail size={16} /></span>
              <span>
                <b>Still have a question?</b>
                <small>Write to us at {email}</small>
              </span>
            </a>
          )}
        </Reveal>

        <Reveal className={x.list}>
          {FAQ.map((item) => (
            <details key={item.q} className={x.item}>
              <summary>
                <span>{item.q}</span>
                <span className={x.toggle} aria-hidden="true"><Plus size={16} /></span>
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
