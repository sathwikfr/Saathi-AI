import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, ContactLine } from '@/components/LegalPage';
import { FREE_TRIAL_DAYS } from '@/lib/plans';

export const metadata: Metadata = {
  title: 'Refund & Cancellation Policy — Aaptha',
  description: 'How cancelling, free trials and refunds work on Aaptha.'
};

/* Plain-language draft that matches the Terms (section 4). Refund terms are a business decision: have them reviewed before launch. */
export default function RefundsPage() {
  return (
    <LegalPage
      title="Refund & Cancellation Policy"
      intro="Short version: you can cancel any time, and you are never charged during a free trial if you cancel before it ends."
    >
      <h2>1. Free trial</h2>
      <p>
        Every paid plan starts with a {FREE_TRIAL_DAYS}-day free trial. Setting it up means authorising Razorpay AutoPay; Razorpay may
        take about ₹5 to check your card or bank, and that amount is refunded to you. The first monthly payment is taken only when the
        trial ends. Cancel before then and nothing is charged.
      </p>

      <h2>2. Cancelling</h2>
      <p>
        Cancel from <Link href="/account/billing">Billing</Link> whenever you like. Your plan keeps working until the end of the
        month you have already paid for, then stops. We do not refund part-months, because the calls and messages for that month
        are still available to you until it ends. Deleting your account (Profile → Delete account) cancels your plan straight away.
      </p>

      <h2>3. Charged by mistake</h2>
      <p>
        If you were charged twice, charged after you cancelled, or charged an amount different from the one shown at checkout,
        write to <ContactLine /> within 30 days with the payment details. We will check and refund what was wrongly taken.
        If we were unable to provide the service because of a fault on our side, we will refund the affected period.
      </p>

      <h2>4. How refunds are paid</h2>
      <p>
        Refunds go back to the card, bank account or UPI ID you paid with, through Razorpay, and normally reach you within
        5–7 working days of our approving them. Your bank may take a little longer to show it.
      </p>

      <h2>5. Plan changes</h2>
      <p>
        If you move to another plan during a month you have paid for, the new plan starts when the paid period ends, so you are
        not charged twice. See our <Link href="/terms">Terms of Service</Link> for the full rules.
      </p>
    </LegalPage>
  );
}
