import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, ContactLine } from '@/components/LegalPage';
import { PLANS, FREE_TRIAL_DAYS, HEALTH_MONITOR, healthMonitorPrice, DAILY_TOUCHES } from '@/lib/plans';

export const metadata: Metadata = {
  title: 'Terms of Service — Aaptha',
  description: 'The rules for using Aaptha and Saathi AI check-in calls.'
};

/*
 * Plain-language draft. It is not legal advice: have a lawyer review it (especially the refund,
 * liability and governing-law clauses, which are business decisions) before launch.
 */
export default function TermsPage() {
  const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
  return (
    <LegalPage
      title="Terms of Service"
      intro="These are the ground rules for using Aaptha. By creating an account you agree to them and to our Privacy Policy."
    >
      <div className="callout">
        <b>Aaptha is not a medical or emergency service.</b> Saathi is an AI that checks in and passes information to
        you. It cannot examine anyone, give medical advice, or send help. In an emergency call <b>112</b>.
      </div>

      <h2>1. What Aaptha does</h2>
      <p>
        We phone the parent or relative you add, on the schedule you set, using an AI voice called Saathi. It asks whether
        medicines were taken and how they are feeling, then shows you the result and alerts you if something needs
        attention. Calls are made in the language you choose.
      </p>

      <h2>2. Who can use it</h2>
      <ul>
        <li>You must be at least 18 and able to enter a contract.</li>
        <li>
          You may add only someone who <b>knows about the calls and has agreed to them</b>. You confirm this when you add
          them, and you must stop the calls if they change their mind.
        </li>
        <li>Give us correct phone numbers. We are not responsible for calls that reach the wrong person because a number was wrong.</li>
      </ul>

      <h2>3. Please understand the limits</h2>
      <ul>
        <li>Calls can go unanswered, fail, or be blocked by the network or phone settings such as Do Not Disturb. We try again and tell you when we cannot reach your parent, but we cannot promise every call connects.</li>
        <li>The AI can mishear or misunderstand, especially on a poor line. Treat the summaries as helpful information, not as medical records or advice.</li>
        <li>Medicine lists read from a prescription photo are only a draft. You must check and confirm them, and we are not responsible for errors you did not correct.</li>
        <li>Never rely on Aaptha to notice an emergency. It is an extra pair of ears, not a replacement for a carer, doctor or emergency services.</li>
      </ul>

      <h2>4. Plans and payment</h2>
      <ul>
        <li>
          <b>Free trial:</b> every plan starts with {FREE_TRIAL_DAYS} free days. To start it you choose a plan and set up
          Razorpay AutoPay; Razorpay may take a small amount (about ₹5) to check your card or bank and refunds it. You can only
          add a parent once AutoPay is set up. The first monthly payment is taken when the trial ends unless you cancel before then.
        </li>
        <li>
          <b>{PLANS.essential.name}:</b> {inr(PLANS.essential.priceMonthly)} a month for WhatsApp medicine checks to {PLANS.essential.parentsIncluded} person
          (up to {PLANS.essential.remindersPerDay} times a day, each asked up to 3 times, no calls), with a {PLANS.essential.trialDays}-day free trial.
          When a dose isn&apos;t confirmed, the caretaker named on the account is told on WhatsApp (at most twice a day). The person and the caretaker
          each start their messages by sending START from their own WhatsApp and can stop them at any time by replying STOP.
        </li>
        <li>
          <b>{PLANS.solo.name}:</b> {inr(PLANS.solo.priceMonthly)} a month for {PLANS.solo.parentsIncluded} parent
          and up to {PLANS.solo.callsPerDay} calls a day, with a {PLANS.solo.trialDays}-day free trial.
        </li>
        <li>
          <b>{PLANS.family.name}:</b> {inr(PLANS.family.priceMonthly)} a month for up to {PLANS.family.parentsIncluded} parents
          and up to {PLANS.family.callsPerDay} calls a day each, with a {PLANS.family.trialDays}-day free trial.
        </li>
        <li>
          <b>{PLANS.extended.name}:</b> {inr(PLANS.extended.priceMonthly)} a month for up to {PLANS.extended.parentsIncluded} parents
          and up to {PLANS.extended.callsPerDay} calls a day each, with a {PLANS.extended.trialDays}-day free trial.
        </li>
        <li>
          Family members who get WhatsApp updates: {PLANS.solo.whatsappPeople} on {PLANS.solo.name}, {PLANS.family.whatsappPeople} on {PLANS.family.name},
          {' '}{PLANS.extended.whatsappPeople} on {PLANS.extended.name}; urgent alerts reach everyone in the family circle who turned WhatsApp on.
          The timeline and one call for a couple sharing a phone are part of {PLANS.family.name} and {PLANS.extended.name}. On any calling plan
          {' '}you can add {HEALTH_MONITOR.name} (BP and sugar by voice, charts and health trends, with a short extra call a day for the readings;
          {' '}₹{healthMonitorPrice('solo')} a month on {PLANS.solo.name}, ₹{healthMonitorPrice('family')} on {PLANS.family.name}, ₹{healthMonitorPrice('extended')} on {PLANS.extended.name})
          {' '}and {DAILY_TOUCHES.name} (festival and birthday wishes, weather notes and the helper check, ₹{DAILY_TOUCHES.priceMonthly} a month, only on calls that have room).
        </li>
        <li>
          &quot;Ask about your parent&quot; is limited each month by plan ({PLANS.solo.askPerMonth} questions on {PLANS.solo.name},
          {' '}{PLANS.family.askPerMonth} on {PLANS.family.name}, {PLANS.extended.askPerMonth} on {PLANS.extended.name}; not part of {PLANS.essential.name}).
        </li>
        <li>Prices are in Indian rupees per month. Taxes such as GST are charged where they apply and shown at checkout.</li>
        <li>Paid plans renew monthly through Razorpay AutoPay. You will not be charged during a free trial if you cancel before it ends.</li>
        <li>You can cancel any time from the billing page. You keep access until the end of the period you have paid for, and we do not refund part-months unless the law requires it.</li>
        <li>We may change prices with at least 30 days&apos; notice. The change applies from your next renewal.</li>
      </ul>

      <h2>5. Using the service properly</h2>
      <p>
        Do not use Aaptha to harass anyone, to call people who have not agreed, to try to break or overload the service,
        or for anything unlawful. We may pause or close an account that does.
      </p>

      <h2>6. Our responsibility</h2>
      <p>
        We work hard to keep Aaptha reliable, but it is provided as is, and outages and errors can happen. To the fullest
        extent the law allows, we are not liable for indirect or consequential loss, or for harm arising from a missed,
        failed or misunderstood call. Nothing here limits any right you have under law that cannot be excluded, and our
        total liability for any claim is limited to what you paid us in the three months before it arose.
      </p>

      <h2>7. Ending your account</h2>
      <p>
        You can stop the calls, delete a parent profile, or close your account at any time. We may suspend or end the service
        if these terms are broken or the law requires it. Your data is handled as described in the{' '}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>8. Changes, law and contact</h2>
      <p>
        We may update these terms and will tell you about material changes before they apply; continuing to use Aaptha
        afterwards means you accept them. These terms are governed by the laws of India, and the courts of competent
        jurisdiction in India will decide disputes. Questions or complaints: write to <ContactLine />.
      </p>
    </LegalPage>
  );
}
