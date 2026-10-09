/**
 * Decides the ONE WhatsApp message a family gets about a call, and its words.
 * Pure functions: no database or network access.
 *
 *   emergency (level 4)       -> aaptha_call_emergency   (sent mid-call by the escalate tool, or at call end)
 *   needs attention (2-3)     -> aaptha_call_alert       (missed medicine, unwell, couldn't reach)
 *   everything else (0-1)     -> aaptha_call_result      (only when the family wants every call result)
 *
 * `minimumAlertLevel` (NotificationPreferences) is the family's choice:
 *   1 = every call result, 2 = only when something needs attention, 3 = health concerns, 4 = emergencies.
 */
import { CallLog } from './types';
import { MedicineResult } from './callInterpretation';
import { WhatsAppTemplateKind, cleanParam, renderTemplate } from './whatsapp';

export interface NotifyAlert {
  id: string;
  level: number;
  title: string;
  message: string;
}

export type FamilyMessageKind = Extract<WhatsAppTemplateKind, 'call_update' | 'attention' | 'emergency'>;

export interface PlannedMessage {
  kind: FamilyMessageKind;
  level: number;
  params: string[];
  /** The rendered text, as the family will read it. */
  body: string;
  /** The alert the "I'll handle it" button acknowledges. */
  alertId: string | null;
}

export interface AnsweredCallFacts {
  slotLabel: string;
  answeredAt?: string | null;
  medicineResults: MedicineResult[];
  mood?: CallLog['mood'] | null;
  feedback?: string | null;
  /** Readings, how an appointment went, whether the helper came. */
  extra?: string[];
}

const STATUS_WORD: Record<MedicineResult['status'], string> = {
  taken: 'taken',
  missed: 'missed',
  unknown: 'not sure',
  later: 'will take later (Saathi will ask again on the next call)',
  stopped: 'stopped taking it'
};

/** "Answered the morning call at 09:10 AM. Medicines: Telmisartan taken, Metformin missed. Mood: calm. They said: "..."" */
export function describeAnsweredCall(f: AnsweredCallFacts): string {
  const parts: string[] = [`Answered the ${f.slotLabel} call${f.answeredAt ? ` at ${f.answeredAt}` : ''}.`];
  if (f.medicineResults.length) {
    parts.push(`Medicines: ${f.medicineResults.map(r => `${r.name} ${STATUS_WORD[r.status]}`).join(', ')}.`);
  }
  if (f.mood) parts.push(`Mood: ${f.mood}.`);
  for (const e of f.extra || []) parts.push(`${e.replace(/\.$/, '')}.`);
  const said = (f.feedback || '').trim();
  if (said) parts.push(`They said: "${cleanParam(said, 200)}"`);
  return parts.join(' ');
}

export function planFamilyMessage(input: {
  parentName: string;
  parentPhone: string;
  alerts: NotifyAlert[];
  /** What happened on the call (answered calls only). */
  update?: string | null;
  minimumAlertLevel: number;
}): PlannedMessage | null {
  const alerts = [...input.alerts].sort((a, b) => b.level - a.level);
  const top = alerts[0];
  const level = top ? top.level : 0;
  const threshold = input.minimumAlertLevel <= 1 ? 0 : input.minimumAlertLevel;
  if (level < threshold) return null;
  if (!top && !input.update) return null;

  const name = cleanParam(input.parentName, 60);
  let kind: FamilyMessageKind;
  let params: string[];

  if (level >= 4) {
    kind = 'emergency';
    params = [name, cleanParam(top.message, 500), cleanParam(input.parentPhone, 20)];
  } else if (level >= 2) {
    kind = 'attention';
    const text = alerts.map(a => a.message).join(' ');
    params = [name, cleanParam(input.update ? `${text} Call details: ${input.update}` : text)];
  } else {
    kind = 'call_update';
    const text = [input.update, ...alerts.map(a => a.message)].filter(Boolean).join(' ');
    params = [name, cleanParam(text)];
  }

  return {
    kind,
    level,
    params,
    body: renderTemplate(kind, params),
    alertId: top && level >= 2 ? top.id : null
  };
}

/** Free-text replies (sent inside the 24 h window the family opened by messaging us). */
export const WA_REPLIES = {
  acknowledged: 'Thanks. We have marked this as handled on your Aaptha dashboard.',
  alreadyAcknowledged: 'This alert was already marked as handled.',
  calling: (parentName: string) => `Saathi is calling ${parentName} now. You will get the result here when the call ends.`,
  callFailed: (reason: string) => `We could not start the call: ${reason}`,
  handledBy: (name: string) => `Thanks. ${name} is already handling this alert.`,
  stopped: 'You will no longer get WhatsApp updates from Aaptha. Reply START to turn them back on.',
  started: 'WhatsApp updates from Aaptha are on. You will get a message after each call.',
  autoReply: (appUrl: string) =>
    `Thanks for your message. This number only sends Aaptha call updates and replies are not read by a person. See all call details at ${appUrl}/dashboard, or reply STOP to turn these messages off.`
} as const;
