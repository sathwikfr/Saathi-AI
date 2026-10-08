/**
 * BP and sugar readings the parent reads out on a call ("my sugar was 140 this
 * morning"), or that the family types in from a home machine. Pure functions:
 * parsing and range checks. No diagnosis: a reading outside the family's range
 * (or a widely used safety limit) only tells the family to check with the doctor.
 */

export type ReadingKind = 'bp' | 'sugar';
export const READING_KINDS: ReadingKind[] = ['bp', 'sugar'];

export interface ReadingRanges {
  bpSysMax?: number;
  bpSysMin?: number;
  bpDiaMax?: number;
  sugarMax?: number;
  sugarMin?: number;
}

/**
 * Limits that always alert, whatever the family set: commonly published thresholds for
 * a BP crisis (180/120), low BP (systolic under 90) and low / very high sugar. Alerts say
 * "check with their doctor"; Saathi itself never comments on a reading.
 */
export const SAFETY_LIMITS = { bpSysCrisis: 180, bpDiaCrisis: 120, bpSysLow: 90, sugarLow: 70, sugarHigh: 300 } as const;

export interface BpReading { systolic: number; diastolic: number }
export interface SugarReading { value: number; context: 'fasting' | 'after_food' | 'random' | null }

const NONE = /^(none|no|nil|n\/a|na|not_asked|not asked|unknown|didn'?t check|not checked)?$/i;

/** "140/90", "140 by 90", "140 over 90", "BP 140-90" -> {140, 90}; null when it isn't a plausible reading. */
export function parseBp(text: string | null | undefined): BpReading | null {
  const t = (text || '').trim();
  if (NONE.test(t)) return null;
  const m = t.match(/(\d{2,3})\s*(?:\/|by|over|-|upon)\s*(\d{2,3})/i);
  if (!m) return null;
  const systolic = parseInt(m[1], 10);
  const diastolic = parseInt(m[2], 10);
  if (systolic < 60 || systolic > 260 || diastolic < 30 || diastolic > 160 || systolic <= diastolic) return null;
  return { systolic, diastolic };
}

/** "150", "150 mg/dl", "sugar 150" -> 150; null when not plausible. */
export function parseSugar(text: string | null | undefined, context?: string | null): SugarReading | null {
  const t = (text || '').trim();
  if (NONE.test(t)) return null;
  const m = t.match(/(\d{2,3}(?:\.\d)?)/);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (value < 20 || value > 600) return null;
  const c = (context || '').toLowerCase();
  const ctx = /fast|empty|before/.test(c) ? 'fasting' : /after|post|food|meal/.test(c) ? 'after_food' : /random/.test(c) ? 'random' : null;
  return { value, context: ctx };
}

export function parseRanges(json: string | null | undefined): ReadingRanges {
  if (!json) return {};
  try {
    const r = JSON.parse(json);
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 700 ? v : undefined);
    return { bpSysMax: num(r.bpSysMax), bpSysMin: num(r.bpSysMin), bpDiaMax: num(r.bpDiaMax), sugarMax: num(r.sugarMax), sugarMin: num(r.sugarMin) };
  } catch {
    return {};
  }
}

export interface RangeCheck {
  outside: boolean;
  /** Plain words for the family: "above the 150/95 you set", "below 70". */
  why: string;
}

export function checkBp(r: BpReading, ranges: ReadingRanges): RangeCheck {
  const reasons: string[] = [];
  if (r.systolic >= SAFETY_LIMITS.bpSysCrisis || r.diastolic >= SAFETY_LIMITS.bpDiaCrisis) reasons.push('at a level doctors treat as urgent (180/120 or more)');
  else if (r.systolic < SAFETY_LIMITS.bpSysLow) reasons.push('low (top number under 90)');
  if (ranges.bpSysMax && r.systolic > ranges.bpSysMax) reasons.push(`above the ${ranges.bpSysMax}${ranges.bpDiaMax ? `/${ranges.bpDiaMax}` : ''} you set`);
  else if (ranges.bpDiaMax && r.diastolic > ranges.bpDiaMax) reasons.push(`above the ${ranges.bpSysMax ? `${ranges.bpSysMax}/` : 'lower number of '}${ranges.bpDiaMax} you set`);
  if (ranges.bpSysMin && r.systolic < ranges.bpSysMin) reasons.push(`below the ${ranges.bpSysMin} you set`);
  return { outside: reasons.length > 0, why: [...new Set(reasons)].join(', ') };
}

export function checkSugar(r: SugarReading, ranges: ReadingRanges): RangeCheck {
  const reasons: string[] = [];
  if (r.value < SAFETY_LIMITS.sugarLow) reasons.push('low (under 70)');
  else if (r.value > SAFETY_LIMITS.sugarHigh) reasons.push('very high (over 300)');
  if (ranges.sugarMax && r.value > ranges.sugarMax) reasons.push(`above the ${ranges.sugarMax} you set`);
  if (ranges.sugarMin && r.value < ranges.sugarMin) reasons.push(`below the ${ranges.sugarMin} you set`);
  return { outside: reasons.length > 0, why: [...new Set(reasons)].join(', ') };
}

export function describeBp(r: BpReading) {
  return `BP ${r.systolic}/${r.diastolic}`;
}

export function describeSugar(r: SugarReading) {
  const when = r.context === 'fasting' ? ' (fasting)' : r.context === 'after_food' ? ' (after food)' : '';
  return `sugar ${Math.round(r.value)}${when}`;
}
