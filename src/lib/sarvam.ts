/**
 * Sarvam Voice Agents client (Instant Outbound calls).
 * Docs: https://docs.sarvam.ai/conversations/api/instant-outbound/create
 *
 * Auth is an `X-API-Key` header. Sarvam does not document webhook signing, so
 * our webhook URL carries a secret token that we verify (see SARVAM_WEBHOOK_SECRET).
 *
 * Two agents use the same number: "Saathi" talks to the parent (reminders, follow-ups,
 * companion calls) and "Aaptha Alert" phones family and neighbours in an emergency.
 */
import { LinkedMedicineDetail } from './types';

export type SarvamLanguage =
  | 'Bengali' | 'Gujarati' | 'Kannada' | 'Malayalam' | 'Tamil' | 'Telugu'
  | 'Punjabi' | 'Sanskrit' | 'Odia' | 'Marathi' | 'Hindi' | 'English' | 'Assamese';

export interface SarvamConfig {
  apiKey: string;
  orgId: string;
  workspaceId: string;
  appId: string;
  appVersion: number;
  connectionId: string;
  agentPhoneNumber: string;
  apiBase: string;
  webhookSecret: string;
  appUrl: string;
}

const DEFAULT_API_BASE = 'https://apps.sarvam.ai/api/outbounds';

/** Returns the config only when every required setting is present. */
export function getSarvamConfig(env: NodeJS.ProcessEnv = process.env): SarvamConfig | null {
  const apiKey = env.SARVAM_API_KEY;
  const orgId = env.SARVAM_ORG_ID;
  const workspaceId = env.SARVAM_WORKSPACE_ID;
  const appId = env.SARVAM_APP_ID;
  const connectionId = env.SARVAM_CONNECTION_ID;
  const agentPhoneNumber = env.SARVAM_AGENT_PHONE_NUMBER;
  const webhookSecret = env.SARVAM_WEBHOOK_SECRET;
  const appUrl = env.NEXT_PUBLIC_APP_URL;
  if (!apiKey || !orgId || !workspaceId || !appId || !connectionId || !agentPhoneNumber || !webhookSecret || !appUrl) {
    return null;
  }
  return {
    apiKey,
    orgId,
    workspaceId,
    appId,
    appVersion: parseInt(env.SARVAM_APP_VERSION || '1', 10) || 1,
    connectionId,
    agentPhoneNumber,
    apiBase: (env.SARVAM_API_BASE || DEFAULT_API_BASE).replace(/\/$/, ''),
    webhookSecret,
    appUrl: appUrl.replace(/\/$/, '')
  };
}

export function isSarvamConfigured(): boolean {
  return getSarvamConfig() !== null;
}

/** Regional languages we recognise in the free-text `ParentProfile.language`. */
const REGIONAL_LANGUAGES: Array<[string, SarvamLanguage]> = [
  ['telugu', 'Telugu'],
  ['tamil', 'Tamil'],
  ['kannada', 'Kannada'],
  ['malayalam', 'Malayalam'],
  ['bengali', 'Bengali'],
  ['marathi', 'Marathi'],
  ['gujarati', 'Gujarati'],
  ['punjabi', 'Punjabi'],
  ['odia', 'Odia'],
  ['assamese', 'Assamese'],
  ['hindi', 'Hindi']
];

/**
 * Maps "Hindi & English", "English & Kannada", "Telugu", … to the language the
 * call should start in. A regional language wins over English so the parent is
 * greeted in their own language; English-only stays English.
 */
export function toSarvamLanguage(language: string | null | undefined): SarvamLanguage {
  const text = (language || '').toLowerCase();
  for (const [needle, value] of REGIONAL_LANGUAGES) {
    if (text.includes(needle)) return value;
  }
  if (text.includes('english')) return 'English';
  return 'Hindi';
}

/** What kind of conversation Saathi should have (the agent prompt branches on it). */
export type CallType = 'reminder' | 'followup' | 'companion' | 'callback';

export interface OutboundCallInput {
  callLogId: string;
  parentId: string;
  slotId?: string | null;
  slot: string;
  slotLabel: string;
  parentName: string;
  parentPhone: string; // E.164
  language: string;
  caregiverName: string;
  relationship: string;
  medicines: LinkedMedicineDetail[];
  callType?: CallType;
  /** First call (or after a "no" / "stop"): Saathi asks the parent's own consent before anything else. */
  askConsent?: boolean;
  /** Once a week: "I will never ask you for money, OTPs or bank details". */
  saySafetyLine?: boolean;
  /** One English sentence about the last call's concern, asked about once. */
  lastCallNote?: string | null;
  /** One wellbeing question today, in turn: sleep / appetite / pain (null = none). */
  wellbeingTopic?: 'sleep' | 'appetite' | 'pain' | null;
  /** "How are you feeling today?" (first answered call of the day). */
  askFeeling?: boolean;
  /** Weekly: "do you have enough of X for the week?" */
  refillMedicines?: string[];
  /** Companion calls: what the family says they like talking about. */
  companionTopics?: string | null;
  /** e.g. "birthday" */
  specialDay?: string | null;
  /** Human support number Saathi can give when asked whether it is real. */
  supportPhone?: string | null;
  // v1.1
  /** "From Ravi: I'll call you on Sunday." (said once, then marked delivered) */
  familyMessage?: string | null;
  /** Doctor / lab reminder for today or tomorrow. */
  appointmentNote?: string | null;
  /** "How did the eye check-up go?" */
  appointmentQuestion?: string | null;
  /** Readings to ask for today: "bp", "sugar". */
  askReadings?: string[];
  /** One sentence on a very hot / cold / rainy day. */
  weatherNote?: string | null;
  /** Slower, clearer, repeats each question once. */
  hearingMode?: boolean;
  /**
   * Family / Extended (plans.firmCallLimit): about 90 seconds in (a couple call: about 1 min 50 s, so both get their turn)
   * Saathi says it will tell the family and ends the call, so a call never runs to 2 minutes. Off (Solo): never cut off.
   */
  firmTimeLimit?: boolean;
  /** "Did Lakshmi come today?" */
  helperQuestion?: string | null;
  /** Couple call: the other parent on the same phone. */
  partner?: { name: string; medicines: LinkedMedicineDetail[]; askReadings: string[] } | null;
}

const READING_WORDS: Record<string, string> = { bp: 'blood pressure (BP)', sugar: 'blood sugar' };
const readingList = (kinds?: string[]) => (kinds || []).map(k => READING_WORDS[k] || k).join(', ') || 'none';

const yesNo = (v: boolean | undefined) => (v ? 'yes' : 'no');

/** Numbered checklist the agent reads from, e.g. "1. Metformin 500 (1 tab) [why: keeps your sugar steady] — Did you take …?" */
export function buildMedicineChecklist(medicines: LinkedMedicineDetail[]): string {
  return medicines
    .map((m, i) => {
      const why = m.purpose?.trim() ? ` [why: ${m.purpose.trim()}]` : '';
      return `${i + 1}. ${m.name}${m.dosage ? ` (${m.dosage})` : ''}${why} — ${m.questionScript || `Did you take your ${m.name}?`}`;
    })
    .join('\n');
}

/**
 * Spoken name of the first medicine, used inside the agent's greeting so the very first turn already asks
 * about a tablet (Sarvam waits for the caller after the greeting). "Telmisartan (BP Tablet)" -> "Telmisartan".
 */
export function firstMedicineSpoken(medicines: LinkedMedicineDetail[]): string {
  const name = medicines[0]?.name || '';
  const cleaned = name.replace(/\(.*?\)/g, ' ').replace(/(tab|tablet|cap|capsule)\.?/gi, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || name.trim() || 'medicine';
}

/** A phone number the way it is read out: "+919876543210" -> "98765 43210". */
export function spokenPhone(e164: string | null | undefined): string {
  const digits = (e164 || '').replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return local.length === 10 ? `${local.slice(0, 5)} ${local.slice(5)}` : local;
}

/** The Saathi agent's input variables. The names are the contract in docs/sarvam-agent.md §3. */
export function buildAgentVariables(input: OutboundCallInput): Record<string, string> {
  return {
    call_log_id: input.callLogId,
    parent_name: input.parentName,
    caregiver_name: input.caregiverName,
    relationship: input.relationship,
    slot: input.slot,
    slot_label: input.slotLabel,
    call_type: input.callType || 'reminder',
    has_medicines: yesNo(input.medicines.length > 0),
    medicine_count: String(input.medicines.length),
    first_medicine: firstMedicineSpoken(input.medicines),
    medicines_checklist: buildMedicineChecklist(input.medicines),
    ask_consent: yesNo(input.askConsent),
    say_safety_line: yesNo(input.saySafetyLine),
    last_call_note: input.lastCallNote?.trim() || 'none',
    // ask_wellbeing (all three at once) is replaced by wellbeing_topic; kept as "no" for agents with the old prompt.
    ask_wellbeing: 'no',
    wellbeing_topic: input.wellbeingTopic || 'none',
    ask_feeling: yesNo(input.askFeeling),
    ask_refill: yesNo(!!input.refillMedicines?.length),
    refill_medicines: (input.refillMedicines || []).join(', ') || 'none',
    companion_topics: input.companionTopics?.trim() || 'none',
    special_day: input.specialDay?.trim() || 'none',
    support_phone: input.supportPhone ? spokenPhone(input.supportPhone) : 'none',
    family_message: input.familyMessage?.trim() || 'none',
    appointment_note: input.appointmentNote?.trim() || 'none',
    appointment_question: input.appointmentQuestion?.trim() || 'none',
    ask_readings: readingList(input.askReadings),
    weather_note: input.weatherNote?.trim() || 'none',
    hearing_mode: yesNo(input.hearingMode),
    firm_time_limit: !input.firmTimeLimit ? 'no' : input.partner ? 'couple' : 'yes',
    helper_question: input.helperQuestion?.trim() || 'none',
    partner_name: input.partner?.name || 'none',
    partner_has_medicines: yesNo(!!input.partner?.medicines.length),
    partner_medicines_checklist: input.partner ? buildMedicineChecklist(input.partner.medicines) || 'none' : 'none',
    partner_ask_readings: input.partner ? readingList(input.partner.askReadings) : 'none'
  };
}

function webhookUrl(cfg: SarvamConfig): string {
  return `${cfg.appUrl}/api/calls/sarvam-webhook?token=${encodeURIComponent(cfg.webhookSecret)}`;
}

export function buildOutboundRequest(cfg: SarvamConfig, input: OutboundCallInput) {
  return {
    app_config: {
      app_id: cfg.appId,
      app_version: cfg.appVersion,
      connection_config: {
        connection_id: cfg.connectionId,
        agent_phone_number: cfg.agentPhoneNumber
      },
      // Agent variables are the "input variables" defined on the Sarvam agent.
      agent_variables: buildAgentVariables(input),
      app_overrides: {
        initial_language_name: toSarvamLanguage(input.language)
      }
    },
    user_config: { user_phone_number: input.parentPhone },
    webhook_config: {
      url: webhookUrl(cfg),
      metadata: {
        callLogId: input.callLogId,
        parentId: input.parentId,
        slotId: input.slotId || null
      }
    }
  };
}

// ---------------------------------------------------------------------------
// "Aaptha Alert" agent (docs/sarvam-agent.md §9)
// ---------------------------------------------------------------------------
export interface AlertAgentConfig {
  appId: string;
  appVersion: number;
}

/** The alert agent's ids; null until SARVAM_ALERT_APP_ID is set (escalations then use WhatsApp only). */
export function getAlertAgentConfig(env: NodeJS.ProcessEnv = process.env): AlertAgentConfig | null {
  const appId = env.SARVAM_ALERT_APP_ID?.trim();
  if (!appId) return null;
  return { appId, appVersion: parseInt(env.SARVAM_ALERT_APP_VERSION || '1', 10) || 1 };
}

/** emergency / wellness_check / practice go to helpers; parent_check calls the parent back during an emergency. */
export type AlertCallKind = 'emergency' | 'wellness_check' | 'practice' | 'parent_check';

export interface AlertCallInput {
  attemptId: string; // EscalationAttempt id
  escalationId: string;
  kind: AlertCallKind;
  recipientName: string;
  recipientPhone: string; // E.164
  parentName: string;
  parentPhone: string;
  parentAddress: string | null;
  familyName: string;
  /** One English sentence: what happened. */
  reason: string;
  language: string;
}

export function buildAlertCallRequest(cfg: SarvamConfig, agent: AlertAgentConfig, input: AlertCallInput) {
  return {
    app_config: {
      app_id: agent.appId,
      app_version: agent.appVersion,
      connection_config: { connection_id: cfg.connectionId, agent_phone_number: cfg.agentPhoneNumber },
      agent_variables: {
        alert_kind: input.kind,
        recipient_name: input.recipientName,
        parent_name: input.parentName,
        parent_phone: spokenPhone(input.parentPhone),
        parent_address: input.parentAddress?.trim() || 'not saved',
        family_name: input.familyName,
        reason: input.reason
      },
      // Neighbours and family hear the alert in the parent's language; the agent follows them if they switch.
      app_overrides: { initial_language_name: toSarvamLanguage(input.language) }
    },
    user_config: { user_phone_number: input.recipientPhone },
    webhook_config: {
      url: webhookUrl(cfg),
      metadata: { escalationAttemptId: input.attemptId, escalationId: input.escalationId }
    }
  };
}

export class SarvamApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

/**
 * Sarvam refused because of OUR account, not the parent's phone: 401/403 = key or access,
 * 402 = Payment Required (credits used up). Retrying or alerting the family won't help.
 */
export function isProviderAccountProblem(httpStatus: number | undefined): boolean {
  return httpStatus === 401 || httpStatus === 402 || httpStatus === 403;
}

export function logProviderProblem(httpStatus: number | undefined) {
  console.error(
    httpStatus === 402
      ? '[calls] Sarvam returned 402 Payment Required: the Sarvam account is out of credits. Top up in the Sarvam dashboard; no calls can be placed until then.'
      : `[calls] Sarvam returned ${httpStatus}: check SARVAM_API_KEY and the agent/workspace ids. No calls can be placed until this is fixed.`
  );
}

async function postOutbound(cfg: SarvamConfig, body: unknown, fetchImpl: typeof fetch = fetch): Promise<{ attemptId: string }> {
  const url = `${cfg.apiBase}/v1/orgs/${encodeURIComponent(cfg.orgId)}/workspaces/${encodeURIComponent(cfg.workspaceId)}/outbounds`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': cfg.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
  } catch (err) {
    throw new SarvamApiError(`Network error contacting Sarvam: ${err instanceof Error ? err.name : 'unknown'}`);
  }

  if (!res.ok) {
    throw new SarvamApiError(`Sarvam rejected the call (HTTP ${res.status})`, res.status);
  }

  const data = (await res.json().catch(() => ({}))) as { attempt_id?: string };
  if (!data.attempt_id) {
    throw new SarvamApiError('Sarvam response did not include an attempt_id', res.status);
  }
  return { attemptId: data.attempt_id };
}

/**
 * Places an instant outbound Saathi call. Returns Sarvam's attempt_id.
 * Errors never include the API key or the webhook token.
 */
export function createOutboundCall(
  cfg: SarvamConfig,
  input: OutboundCallInput,
  fetchImpl: typeof fetch = fetch
): Promise<{ attemptId: string }> {
  return postOutbound(cfg, buildOutboundRequest(cfg, input), fetchImpl);
}

/** Places an "Aaptha Alert" call to a family member, neighbour or the parent. */
export function createAlertCall(
  cfg: SarvamConfig,
  agent: AlertAgentConfig,
  input: AlertCallInput,
  fetchImpl: typeof fetch = fetch
): Promise<{ attemptId: string }> {
  return postOutbound(cfg, buildAlertCallRequest(cfg, agent, input), fetchImpl);
}
