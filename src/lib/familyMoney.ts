/**
 * Small pure helpers for things the family sends themselves (Aaptha never handles money or orders):
 *   - siblings' share of the plan, paid to the payer by UPI;
 *   - a refill list the family sends to their usual chemist on WhatsApp.
 */

/** A UPI ID looks like name@bank. */
export function isValidUpiId(v: string): boolean {
  return /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/.test(v.trim());
}

/** Equal share, rounded up to the rupee so the payer is never short. */
export function shareAmount(planPrice: number, people: number): number {
  if (people <= 1 || planPrice <= 0) return planPrice;
  return Math.ceil(planPrice / people);
}

/** UPI deep link (opens the member's UPI app with the payer, amount and note filled in). */
export function upiLink(input: { upiId: string; payeeName: string; amount: number; note: string }): string {
  const q = new URLSearchParams({ pa: input.upiId.trim(), pn: input.payeeName, am: input.amount.toFixed(2), cu: 'INR', tn: input.note.slice(0, 60) });
  return `upi://pay?${q.toString()}`;
}

/** IST month key, e.g. "2026-10". */
export function istMonth(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600000).toISOString().slice(0, 7);
}

export interface RefillItem {
  name: string;
  dosage?: string;
  quantity: string;
}

/** The WhatsApp text for the family's chemist. */
export function chemistMessage(input: { chemistName?: string | null; parentName: string; address?: string | null; phone?: string | null; items: RefillItem[]; senderName: string }): string {
  const lines = [
    `Hello${input.chemistName ? ` ${input.chemistName}` : ''}, this is ${input.senderName}. Please send these medicines for ${input.parentName}:`,
    ...input.items.filter(i => i.name.trim()).map((i, n) => `${n + 1}. ${i.name}${i.dosage ? ` ${i.dosage}` : ''}: ${i.quantity || '1 strip'}`),
    input.address ? `Address: ${input.address}` : null,
    input.phone ? `Phone: ${input.phone}` : null,
    'Please tell me the total. Thank you.'
  ];
  return lines.filter(Boolean).join('\n');
}
