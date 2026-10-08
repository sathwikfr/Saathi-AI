import {
  ParentProfile,
  Medicine,
  EmergencyContact,
  CallLog,
  AlertRecord,
  ScheduleSuggestion,
  CaregiverInvite,
  NotificationPreferences,
  FoodRelation,
  ScheduledCallSlot,
  HealthInsight,
  ParentAccessRole,
  ReminderView
} from '@/lib/types';
import { timeToMinutes } from '@/lib/scheduleGenerator';
import { CallFact } from '@/lib/insightRules';

export type ParentDetails = {
  parent: ParentProfile;
  medicines: Medicine[];
  emergencyContacts: EmergencyContact[];
  callLogs: CallLog[];
  alerts: AlertRecord[];
  suggestions: ScheduleSuggestion[];
  caregivers: CaregiverInvite[];
  notifPrefs: NotificationPreferences;
  role: ParentAccessRole;
  insights: HealthInsight[];
  saathiNumber: string | null;
  supportPhone: string | null;
  cardUrl: string | null;
  /** Owner only: other parents on the account with the same phone (can be called together). */
  callTogetherCandidates?: { id: string; name: string }[];
  /** How this person's reminders go out (follows the owner's plan): Saathi calls, or WhatsApp only. */
  channel?: 'call' | 'whatsapp';
  /** The owner's plan: 'whatsapp' = Remind (can't switch to calls). */
  ownerPlanChannel?: 'call' | 'whatsapp';
  /** The owner's plan limits (premium = Family / Extended features). */
  ownerPlan?: { id: string; name: string; premium: boolean; askPerMonth: number; whatsappPeople: number; healthMonitor?: boolean; healthMonitorPrice?: number };
  /** Health Monitor: the time of the short readings call, if one is set. */
  vitalsCall?: string | null;
  /** WhatsApp reminders, last 14 days, newest first. */
  reminders?: ReminderView[];
  /** Managers only: the WhatsApp START link for this person. */
  reminderStart?: { whatsappReady: boolean; link: string | null; code: string | null; caretakerLink?: string | null } | null;
};

/** Owner or co-manager: may change calls, medicines, contacts. */
export function canManage(role?: ParentAccessRole) {
  return role === 'owner' || role === 'co_manager';
}

/** A call log as the insight rules see it (client side, for the "usual vs this week" card). */
export function callLogToFact(c: CallLog): CallFact {
  const at = new Date(c.createdAt || c.scheduledTime);
  return {
    id: c.id,
    date: new Date(at.getTime() + 5.5 * 3600000).toISOString().slice(0, 10),
    at,
    status: c.status,
    scheduled: !!c.slotId && !['companion', 'followup', 'callback', 'test', 'manual'].includes(c.slot || ''),
    mood: c.mood,
    healthConcern: c.details?.healthConcern || null,
    feedback: c.notes || null,
    pain: c.details?.pain || null,
    painWhere: c.details?.painWhere || null,
    sleep: c.details?.sleep || null,
    appetite: c.details?.appetite || null,
    parentWords: null,
    medicineResults: c.details?.medicineResults || []
  };
}

/** wa.me link that opens WhatsApp with a message ready to send (to a number, or let them pick a chat). */
export function whatsappShareLink(text: string, phone?: string) {
  const to = phone ? phone.replace(/\D/g, '') : '';
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export type Toast = { text: string; type: 'success' | 'info' | 'error' };

export const MOOD_LABELS: Record<string, string> = {
  cheerful: 'Cheerful',
  calm: 'Calm',
  neutral: 'Neutral',
  anxious: 'Anxious',
  unwell: 'Unwell'
};

export function moodLabel(mood?: string) {
  return mood ? MOOD_LABELS[mood] || mood : '—';
}

export function foodRelationLabel(rel?: FoodRelation) {
  if (rel === 'before_food') return 'Before food';
  if (rel === 'after_food') return 'After food';
  if (rel === 'with_food') return 'With food';
  return null;
}

export function formatCallTime(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function formatDuration(seconds: number) {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

/** "amma" -> "Amma"; leaves names that already have capitals alone. */
export function displayName(name?: string) {
  const n = (name || '').trim();
  return n && n === n.toLowerCase() ? n.charAt(0).toUpperCase() + n.slice(1) : n;
}

/** "Morning Medicine Reminder — Tab. X, Tab. Y" -> "Morning Medicine Reminder" (medicines are shown separately). */
export function shortSlotLabel(label?: string) {
  return (label || 'Check-in call').split(/\s+[—–-]\s+/)[0].trim();
}

/** "+918309426043" -> "+91 83094 26043"; other numbers are left as stored. */
export function formatPhone(phone?: string) {
  const m = /^\+91(\d{5})(\d{5})$/.exec(phone || '');
  return m ? `+91 ${m[1]} ${m[2]}` : phone || '';
}

/** Owner-requested calls (not part of the daily schedule). */
export function isTestCall(c: CallLog) {
  return c.slot === 'test' || c.slot === 'manual';
}

export type SlotOutcome = { tone: 'good' | 'warn' | 'live' | 'muted'; text: string };

/** What happened today at one scheduled call time, from that slot's latest call log (retries included). */
export function slotOutcome(calls: CallLog[], slotId: string, isPast: boolean): SlotOutcome | null {
  const c = calls.find(l => l.slotId === slotId);
  if (!c) return isPast ? { tone: 'muted', text: 'No call' } : null;
  if (c.status === 'scheduled' || c.status === 'placed') return { tone: 'live', text: 'Calling…' };
  if (c.status === 'answered') {
    return c.medicationConfirmed ? { tone: 'good', text: 'Taken' } : { tone: 'warn', text: 'Not confirmed' };
  }
  if (c.status === 'busy') return { tone: 'warn', text: 'Line busy' };
  if (c.status === 'failed') return { tone: 'warn', text: 'Couldn’t connect' };
  return { tone: 'warn', text: 'No answer' };
}

export function initial(name?: string) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

function callDate(c: CallLog) {
  const d = new Date(c.createdAt || c.scheduledTime);
  return Number.isNaN(d.getTime()) ? null : d;
}

const sameDay = (a: Date | null, b: Date) => !!a && a.toDateString() === b.toDateString();

export type DayBar = { day: string; total: number; pct: number; mood?: string; concern: boolean };

export type CallStats = {
  now: Date;
  completedCalls: CallLog[];
  /** Every call log from today, newest first, including ones still in progress. */
  todayCalls: CallLog[];
  latestToday?: CallLog;
  activeSlots: ScheduledCallSlot[];
  nextSlot?: ScheduledCallSlot;
  nowMinutes: number;
  last30: CallLog[];
  answered30: CallLog[];
  confirmed30: number;
  reachabilityPct: number | null;
  adherencePct: number | null;
  moodBreakdown: { mood: string; pct: number }[];
  last7Days: DayBar[];
};

/** Real call analytics for one parent; no demo numbers. */
export function computeCallStats(callLogs: CallLog[], schedule: ScheduledCallSlot[]): CallStats {
  const now = new Date();
  // Calls still being placed / waiting for a result are not outcomes yet.
  const completedCalls = callLogs.filter(c => c.status !== 'scheduled' && c.status !== 'placed');
  const latestToday = completedCalls.find(c => sameDay(callDate(c), now));
  const todayCalls = callLogs.filter(c => sameDay(callDate(c), now));
  const activeSlots = [...schedule]
    .filter(s => s.isActive)
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nextSlot = activeSlots.find(s => timeToMinutes(s.time) > nowMinutes);

  const last30 = completedCalls.filter(c => {
    const d = callDate(c);
    return !!d && now.getTime() - d.getTime() <= 30 * 86400000;
  });
  const answered30 = last30.filter(c => c.status === 'answered');
  const confirmed30 = answered30.filter(c => c.medicationConfirmed).length;
  const reachabilityPct = last30.length ? Math.round((answered30.length / last30.length) * 100) : null;
  const adherencePct = answered30.length ? Math.round((confirmed30 / answered30.length) * 100) : null;

  const moodCounts = answered30.reduce<Record<string, number>>((acc, c) => {
    acc[c.mood] = (acc[c.mood] || 0) + 1;
    return acc;
  }, {});
  const moodBreakdown = Object.entries(moodCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([mood, count]) => ({ mood, pct: Math.round((count / answered30.length) * 100) }));

  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (6 - i));
    const calls = completedCalls.filter(c => sameDay(callDate(c), d));
    const answered = calls.filter(c => c.status === 'answered');
    const confirmed = answered.filter(c => c.medicationConfirmed);
    return {
      day: d.toLocaleDateString('en-IN', { weekday: 'short' }),
      total: calls.length,
      pct: calls.length ? Math.round((confirmed.length / calls.length) * 100) : 0,
      mood: answered[0]?.mood,
      concern: answered.some(c => c.mood === 'unwell' || c.mood === 'anxious') || answered.length < calls.length
    };
  });

  return {
    now,
    completedCalls,
    todayCalls,
    latestToday,
    activeSlots,
    nextSlot,
    nowMinutes,
    last30,
    answered30,
    confirmed30,
    reachabilityPct,
    adherencePct,
    moodBreakdown,
    last7Days
  };
}

export function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9]/g, '_');
}
