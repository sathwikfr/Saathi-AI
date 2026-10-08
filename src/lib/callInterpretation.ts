/**
 * Turns Sarvam's end-of-call data into Aaptha's call record and alert
 * decisions. Pure functions: no database or network access.
 *
 * The Sarvam agent's OUTPUT variables (docs/sarvam-agent.md §4) are the contract:
 *   all_medicines_taken    yes | no | partial | not_asked
 *   medicines_taken        comma-separated names
 *   medicines_missed       comma-separated names
 *   medicines_later        names the parent will take later / "not yet"
 *   medicines_stopped      names the parent says they stopped taking on their own
 *   stopped_reason         why (free text), "none"
 *   medicines_running_low  names running out (weekly refill question)
 *   mood                   cheerful | calm | neutral | anxious | unwell
 *   health_concern         free text, empty / "none" when nothing
 *   emergency              yes | no
 *   feedback               free text (what the parent wants the family to know)
 *   call_summary           1-2 sentence English summary
 *   consent                yes | no | unclear | not_asked
 *   stop_calls             yes | no ("stop calling me")
 *   sleep / appetite       good | poor | not_asked
 *   pain                   none | mild | severe | not_asked
 *   pain_where             where it hurts, "none"
 *   bp_reading             "140/90" or "none" (only when asked)
 *   sugar_reading          "150" or "none"; sugar_when: fasting | after_food | random | not_asked
 *   appointment_update     how the doctor visit / test went, one English sentence, "none"
 *   helper_visited         yes | no | not_asked
 *   memory_title / memory_story   a memory the parent shared (3-6 English sentences), "none"
 *   partner_*              couple calls: the same answers for the second parent
 *                          (partner_all_medicines_taken, partner_medicines_taken, partner_medicines_missed,
 *                          partner_medicines_later, partner_medicines_stopped, partner_mood,
 *                          partner_health_concern, partner_emergency, partner_feedback,
 *                          partner_bp_reading, partner_sugar_reading, partner_sugar_when)
 */
import { LinkedMedicineDetail, CallLog, MedicineStatus } from './types';
import { scanForEmergency, scanForSymptoms, TranscriptTurn } from './safety';
import { BpReading, SugarReading, ReadingRanges, parseBp, parseSugar, checkBp, checkSugar, describeBp, describeSugar } from './readings';

export type SarvamStatus = 'connected' | 'no_answer' | 'busy' | 'failed';
export const SARVAM_STATUSES: SarvamStatus[] = ['connected', 'no_answer', 'busy', 'failed'];

export interface SarvamWebhookPayload {
  attempt_id?: unknown;
  status?: unknown;
  duration?: unknown;
  interaction_id?: unknown;
  failure_reason?: unknown;
  final_agent_variables?: unknown;
  output_agent_variables?: unknown;
  interaction_transcript?: unknown;
  webhook_config?: unknown;
  metadata?: unknown;
  user_phone_number?: unknown;
}

export interface MedicineResult {
  name: string;
  status: MedicineStatus;
}

export type ConsentAnswer = 'yes' | 'no' | 'unclear' | 'not_asked';
export type Wellbeing = 'good' | 'poor' | null;
export type PainLevel = 'none' | 'mild' | 'severe' | null;

export interface Interpretation {
  medicationConfirmed: boolean;
  medicineResults: MedicineResult[];
  mood: CallLog['mood'];
  healthConcern: string | null;
  emergencyFlag: boolean;
  feedback: string | null;
  summary: string;
  transcript: TranscriptTurn[];
  /** The line connected but the parent never answered (nothing said, nothing confirmed): treated like a missed call. */
  noResponse: boolean;
  consent: ConsentAnswer;
  stopCalls: boolean;
  /** Medicines (from the refill question) the parent says are running out. */
  runningLow: string[];
  stoppedReason: string | null;
  sleep: Wellbeing;
  appetite: Wellbeing;
  pain: PainLevel;
  painWhere: string | null;
  /** Words the parent spoke (for the "shorter answers than usual" trend). */
  parentWords: number;
  bp: BpReading | null;
  sugar: SugarReading | null;
  appointmentUpdate: string | null;
  helperVisited: 'yes' | 'no' | null;
  memory: { title: string; text: string } | null;
}

export interface AlertDecision {
  level: 1 | 2 | 3 | 4;
  title: string;
  message: string;
}

export const ALERT_TITLES = {
  emergency: 'Possible emergency reported during call',
  health: 'Health concern mentioned',
  missed: 'Missed medicine',
  mood: 'Parent seemed low during call',
  unreachable: "Couldn't reach your parent",
  failed: 'Call could not be placed',
  consentDeclined: 'Parent said no to the calls',
  stopRequested: 'Parent asked Saathi to stop calling',
  stoppedMedicine: 'Parent stopped taking a medicine',
  runningLow: 'Medicine running low',
  insightsCombined: 'Several changes this week',
  reading: 'Reading outside the usual range',
  helperMissed: "Helper didn't come today",
  escalationExhausted: 'Nobody has confirmed they are helping',
  wellnessCheck: 'Asked a neighbour to check'
} as const;

const NO_CONCERN = new Set(['', 'none', 'no', 'nil', 'n/a', 'na', 'nothing', 'no concern', 'no concerns', 'null', 'not applicable', 'not_asked', 'not asked']);

function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function asVariables(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Output variables: Sarvam sends them in `final_agent_variables` (instant outbound) or `output_agent_variables` (inbound). */
export function agentVariables(payload: SarvamWebhookPayload): Record<string, unknown> {
  return { ...asVariables(payload.output_agent_variables), ...asVariables(payload.final_agent_variables) };
}

export function parseTranscript(value: unknown): TranscriptTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: TranscriptTurn[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const role = asText(rec.role).toLowerCase();
    const text = asText(rec.en_text) || asText(rec.text);
    const native = asText(rec.indic_text);
    if (role && text) turns.push({ role, text, ...(native && native !== text ? { native } : {}) });
    else if (role && native) turns.push({ role, text: native });
  }
  return turns;
}

export function countParentWords(transcript: TranscriptTurn[]): number {
  return transcript
    .filter(t => t.role === 'user')
    .reduce((sum, t) => sum + t.text.split(/\s+/).filter(Boolean).length, 0);
}

function splitList(value: string): string[] {
  if (NO_CONCERN.has(value.trim().toLowerCase())) return [];
  return value
    .split(/[,;\n|]+/)
    .map(s => s.trim().toLowerCase())
    .filter(s => s && !NO_CONCERN.has(s));
}

/** "Telmisartan (BP Tablet) 40mg" → "telmisartan" (drop brackets, doses and filler words). */
export function medicineKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b\d+(\.\d+)?\s*(mg|mcg|ml|g|iu)\b/g, ' ')
    .replace(/\b(tab|tablet|cap|capsule|syp|syrup|inj)\b\.?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mentions(list: string[], medicine: string): boolean {
  const key = medicineKey(medicine);
  if (!key) return false;
  return list.some(item => {
    const other = medicineKey(item);
    return other && (other.includes(key) || key.includes(other));
  });
}

function normaliseMood(value: string): CallLog['mood'] {
  const v = value.toLowerCase();
  if (!v) return 'neutral';
  if (/(cheer|happy|joy|good|great|positive|energetic|active)/.test(v)) return 'cheerful';
  if (/(unwell|sick|ill|pain|poor|bad|weak|tired|unhealthy)/.test(v)) return 'unwell';
  if (/(anx|worr|sad|low|stress|upset|lonely|nervous|depress)/.test(v)) return 'anxious';
  if (/(calm|relax|fine|ok|okay|peace|content|normal)/.test(v)) return 'calm';
  return 'neutral';
}

function normaliseConsent(value: string): ConsentAnswer {
  const v = value.toLowerCase();
  if (['yes', 'true', 'agreed', 'given', 'ok', 'okay'].includes(v)) return 'yes';
  if (['no', 'false', 'declined', 'refused'].includes(v)) return 'no';
  if (['unclear', 'unsure', 'maybe'].includes(v)) return 'unclear';
  return 'not_asked';
}

function normaliseWellbeing(value: string): Wellbeing {
  const v = value.toLowerCase();
  if (/^(good|well|fine|normal|ok|okay|yes)/.test(v)) return 'good';
  if (/^(poor|bad|not good|less|little|no|low)/.test(v)) return 'poor';
  return null;
}

function normalisePain(value: string): PainLevel {
  const v = value.toLowerCase();
  if (!v || v === 'not_asked' || v === 'not asked') return null;
  if (/(severe|bad|a lot|very|strong|high)/.test(v)) return 'severe';
  if (/(mild|little|some|slight|moderate|yes)/.test(v)) return 'mild';
  if (/^(none|no|nil|not)/.test(v)) return 'none';
  return null;
}

const isYes = (value: unknown) => ['yes', 'true', '1'].includes(asText(value).toLowerCase());

/** Couple calls: the partner's answers as an ordinary payload (partner_mood -> mood, …). */
export function partnerPayload(payload: SarvamWebhookPayload): SarvamWebhookPayload {
  const vars = agentVariables(payload);
  const mapped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(vars)) if (k.startsWith('partner_')) mapped[k.slice('partner_'.length)] = v;
  // Things only the primary parent is asked about stay with them.
  return { ...payload, final_agent_variables: mapped, output_agent_variables: undefined };
}

export interface InterpretOptions {
  /** Medicines Saathi asked the refill question about (the running-low answer is matched against these). */
  refillMedicines?: string[];
}

export function interpretCallResult(
  payload: SarvamWebhookPayload,
  medicines: LinkedMedicineDetail[],
  parentName: string,
  opts: InterpretOptions = {}
): Interpretation {
  const vars = agentVariables(payload);
  const transcript = parseTranscript(payload.interaction_transcript);

  const allTaken = asText(vars.all_medicines_taken).toLowerCase();
  const takenList = splitList(asText(vars.medicines_taken));
  const missedList = splitList(asText(vars.medicines_missed));
  const laterList = splitList(asText(vars.medicines_later));
  const stoppedList = splitList(asText(vars.medicines_stopped));

  // Most specific answer wins: stopped > later > missed > taken > the overall yes/no.
  const medicineResults: MedicineResult[] = medicines.map(m => {
    if (mentions(stoppedList, m.name)) return { name: m.name, status: 'stopped' as const };
    if (mentions(laterList, m.name)) return { name: m.name, status: 'later' as const };
    if (mentions(missedList, m.name)) return { name: m.name, status: 'missed' as const };
    if (mentions(takenList, m.name)) return { name: m.name, status: 'taken' as const };
    if (allTaken === 'yes') return { name: m.name, status: 'taken' as const };
    if (allTaken === 'no') return { name: m.name, status: 'missed' as const };
    return { name: m.name, status: 'unknown' as const };
  });

  // A call with nothing to confirm (wellness-only) is not a failed confirmation.
  const medicationConfirmed = medicineResults.every(r => r.status === 'taken');

  const concernText = asText(vars.health_concern);
  const healthConcern = NO_CONCERN.has(concernText.toLowerCase()) ? null : concernText.slice(0, 300);
  const emergencyFlag = isYes(vars.emergency);
  const feedbackText = asText(vars.feedback);
  const feedback = NO_CONCERN.has(feedbackText.toLowerCase()) ? null : feedbackText.slice(0, 500);
  const mood = normaliseMood(asText(vars.mood));
  const consent = normaliseConsent(asText(vars.consent));
  const stopCalls = isYes(vars.stop_calls);

  const lowList = splitList(asText(vars.medicines_running_low));
  const refillNames = opts.refillMedicines || [];
  const runningLow = refillNames.length
    ? refillNames.filter(name => mentions(lowList, name))
    : lowList.map(s => s.slice(0, 80));
  const stoppedReasonText = asText(vars.stopped_reason);
  const stoppedReason = NO_CONCERN.has(stoppedReasonText.toLowerCase()) ? null : stoppedReasonText.slice(0, 200);
  const painWhereText = asText(vars.pain_where);
  const painWhere = NO_CONCERN.has(painWhereText.toLowerCase()) ? null : painWhereText.slice(0, 80);
  const apptText = asText(vars.appointment_update);
  const helper = asText(vars.helper_visited).toLowerCase();
  const memoryText = asText(vars.memory_story);
  const memory = NO_CONCERN.has(memoryText.toLowerCase()) || memoryText.length < 40
    ? null
    : { title: (asText(vars.memory_title) || 'A memory').slice(0, 80), text: memoryText.slice(0, 2000) };

  const taken = medicineResults.filter(r => r.status === 'taken').map(r => r.name);
  const missed = medicineResults.filter(r => r.status === 'missed').map(r => r.name);
  const later = medicineResults.filter(r => r.status === 'later').map(r => r.name);
  const agentSummary = asText(vars.call_summary);

  let summary = agentSummary.slice(0, 600);
  if (!summary) {
    const parts: string[] = [`${parentName} answered the check-in call.`];
    if (consent === 'no') parts.push('They said they do not want these calls.');
    if (stopCalls) parts.push('They asked Saathi to stop calling.');
    if (medicines.length > 0) {
      if (taken.length) parts.push(`Took: ${taken.join(', ')}.`);
      if (missed.length) parts.push(`Not taken: ${missed.join(', ')}.`);
      if (later.length) parts.push(`Will take later: ${later.join(', ')}.`);
      if (!taken.length && !missed.length && !later.length) parts.push('Medicine confirmation could not be determined.');
    }
    parts.push(`Mood: ${mood}.`);
    if (healthConcern) parts.push(`Health concern: ${healthConcern}.`);
    summary = parts.join(' ');
  }

  // Picked up but silent: the agent asked, got nothing and hung up. Only applies to calls that had medicines to ask about.
  const parentSpoke = transcript.some(t => t.role === 'user');
  const nothingConfirmed = medicineResults.every(r => r.status === 'unknown');
  const noResponse =
    medicines.length > 0 &&
    nothingConfirmed &&
    !emergencyFlag &&
    !healthConcern &&
    !feedback &&
    consent !== 'no' &&
    !stopCalls &&
    (transcript.length > 0 ? !parentSpoke : allTaken === 'not_asked');

  return {
    medicationConfirmed,
    medicineResults,
    mood,
    healthConcern,
    emergencyFlag,
    feedback,
    summary,
    transcript,
    noResponse,
    consent,
    stopCalls,
    runningLow,
    stoppedReason,
    sleep: normaliseWellbeing(asText(vars.sleep)),
    appetite: normaliseWellbeing(asText(vars.appetite)),
    pain: normalisePain(asText(vars.pain)),
    painWhere,
    parentWords: countParentWords(transcript),
    bp: parseBp(asText(vars.bp_reading)),
    sugar: parseSugar(asText(vars.sugar_reading), asText(vars.sugar_when)),
    appointmentUpdate: NO_CONCERN.has(apptText.toLowerCase()) ? null : apptText.slice(0, 300),
    helperVisited: helper === 'yes' ? 'yes' : helper === 'no' ? 'no' : null,
    memory
  };
}

export interface DecideOptions {
  /** On a follow-up call, "later" again counts as not taken. */
  callType?: string;
  /** The last scheduled call of the day: "later" counts as not taken too (there are no follow-up calls). */
  finalCall?: boolean;
  /** The family's / doctor's range for readings (safety limits always apply). */
  ranges?: ReadingRanges;
  helperName?: string | null;
  /** Couple calls: the transcript scan belongs to the primary parent's alerts only (one escalation per call). */
  skipScan?: boolean;
}

/**
 * Which alerts a completed conversation should raise. Level 4 also comes from
 * the independent transcript scan, not only from the agent's own judgement.
 * Wording is for the family: it never names a condition or gives medical advice.
 */
export function decideAlerts(interp: Interpretation, parentName: string, slotLabel: string, opts: DecideOptions = {}): AlertDecision[] {
  const alerts: AlertDecision[] = [];
  const scan = opts.skipScan ? { hit: false, matches: [] as string[] } : scanForEmergency(interp.transcript);

  if (interp.emergencyFlag || scan.hit) {
    const heard = scan.hit ? ` (heard: "${scan.matches.slice(0, 3).join('", "')}")` : '';
    alerts.push({
      level: 4,
      title: ALERT_TITLES.emergency,
      message: `During the ${slotLabel} call, ${parentName} may have described an emergency${heard}. Please call ${parentName} right away. If it is serious, call 112 or ask someone nearby to go to them.`
    });
  }

  if (interp.consent === 'no') {
    alerts.push({
      level: 2,
      title: ALERT_TITLES.consentDeclined,
      message: `When Saathi asked, ${parentName} said they don't want these calls, so calls are paused. Please talk it over with them. If they change their mind, resume calls on the dashboard and Saathi will ask again.`
    });
  }

  if (interp.stopCalls) {
    alerts.push({
      level: 2,
      title: ALERT_TITLES.stopRequested,
      message: `${parentName} asked Saathi to stop calling, so calls are paused. Please talk with them. If they want the calls again, resume them on the dashboard and Saathi will ask first.`
    });
  }

  const severePain = interp.pain === 'severe';
  // Backup to the agent's own judgement (2026-10-05): fever, headache, dizziness, … heard in the parent's words
  // always tell the family the same day, on every plan.
  const symptoms = opts.skipScan ? { hit: false, matches: [] as string[] } : scanForSymptoms(interp.transcript);
  if (interp.healthConcern || interp.mood === 'unwell' || severePain || symptoms.hit) {
    const detail = interp.healthConcern
      ? `: "${interp.healthConcern}"`
      : severePain
        ? `: said the pain${interp.painWhere ? ` in their ${interp.painWhere}` : ''} is bad`
        : symptoms.hit
          ? ` (heard: "${symptoms.matches.slice(0, 3).join('", "')}")`
          : '';
    alerts.push({
      level: 3,
      title: ALERT_TITLES.health,
      message: `${parentName} mentioned not feeling well${detail}. Please check in with them today.`
    });
  }

  const stopped = interp.medicineResults.filter(r => r.status === 'stopped').map(r => r.name);
  if (stopped.length > 0) {
    alerts.push({
      level: 3,
      title: ALERT_TITLES.stoppedMedicine,
      message: `${parentName} said they have stopped taking ${stopped.join(', ')}${interp.stoppedReason ? ` ("${interp.stoppedReason}")` : ''}. Please talk to their doctor before anything changes. Saathi did not give any advice.`
    });
  }

  const followUp = opts.callType === 'followup';
  const laterCounts = followUp || opts.finalCall === true;
  const missed = interp.medicineResults
    .filter(r => r.status === 'missed' || (laterCounts && r.status === 'later'))
    .map(r => r.name);
  if (missed.length > 0) {
    alerts.push({
      level: 2,
      title: ALERT_TITLES.missed,
      message: followUp
        ? `${parentName} still had not taken ${missed.join(', ')} when Saathi called back.`
        : opts.finalCall && interp.medicineResults.some(r => r.status === 'later' && missed.includes(r.name))
          ? `${parentName} still had not taken ${missed.join(', ')} by the last call of the day (${slotLabel} call).`
          : `${parentName} had not taken: ${missed.join(', ')} (${slotLabel} call).`
    });
  }

  if (interp.runningLow.length > 0) {
    alerts.push({
      level: 2,
      title: ALERT_TITLES.runningLow,
      message: `${parentName} said they are running low on ${interp.runningLow.join(', ')}. Please arrange a refill before it runs out.`
    });
  }

  const readingsOut: string[] = [];
  if (interp.bp) {
    const c = checkBp(interp.bp, opts.ranges || {});
    if (c.outside) readingsOut.push(`${describeBp(interp.bp)} (${c.why})`);
  }
  if (interp.sugar) {
    const c = checkSugar(interp.sugar, opts.ranges || {});
    if (c.outside) readingsOut.push(`${describeSugar(interp.sugar)} (${c.why})`);
  }
  if (readingsOut.length) {
    alerts.push({
      level: 3,
      title: ALERT_TITLES.reading,
      message: `${parentName}'s reading today: ${readingsOut.join('; ')}. Please check in with ${parentName} and their doctor. Saathi did not comment on it.`
    });
  }

  if (interp.helperVisited === 'no' && opts.helperName) {
    alerts.push({
      level: 2,
      title: ALERT_TITLES.helperMissed,
      message: `${parentName} said ${opts.helperName} didn't come today.`
    });
  }

  if (interp.mood === 'anxious') {
    alerts.push({
      level: 1,
      title: ALERT_TITLES.mood,
      message: `${parentName} sounded low or worried during the ${slotLabel} call. A call from family might help.`
    });
  }

  return alerts;
}
