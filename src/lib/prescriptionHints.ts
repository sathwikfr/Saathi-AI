/**
 * Reads the instruction line the prescription reader returns as `dosage`
 * ("1 tab BD (1-0-1 Morning & Night after food) x 5 days") into the review form's own fields:
 * course length, food, a tidy amount, and a plain "what it's for" suggestion.
 * Pure. Everything filled here is still a draft the family checks and confirms.
 */
import { ExtractedMedicineCandidate, FoodRelation } from './types';
import { freeNickname } from './callInterpretation';
import { cleanMedicineNameForSpeech } from './scheduleGenerator';

/** Longer "x 30/90 days" on BP or sugar tablets usually means "until the next visit", not "stop then". */
export const AUTO_COURSE_MAX_DAYS = 15;

export interface InstructionHints {
  /** Course length in days ("x 5 days", "for 1 week", "x 5/7", "x 1 month"). */
  days?: number;
  food?: FoodRelation;
  /** Just the amount: "1 tablet", "Half tablet", "5 ml", "2 drops", "Apply". */
  dose?: string;
}

const UNIT_DAYS: Record<string, number> = { d: 1, day: 1, days: 1, w: 7, wk: 7, wks: 7, week: 7, weeks: 7, mo: 30, month: 30, months: 30 };

function readDays(text: string): number | undefined {
  // Clinic shorthand: 5/7 = 5 days, 2/52 = 2 weeks, 1/12 = 1 month.
  const frac = text.match(/\b(\d{1,3})\s*\/\s*(7|52|12)\b/);
  if (frac) return Number(frac[1]) * ({ '7': 1, '52': 7, '12': 30 } as Record<string, number>)[frac[2]];
  const unit = text.match(/(?:\bx|×|\bfor)\s*(\d{1,3})\s*(days?|d|weeks?|wks?|w|months?|mo)\b/i) || text.match(/\b(\d{1,3})\s*(days?|weeks?|months?)\b/i);
  if (unit) return Number(unit[1]) * UNIT_DAYS[unit[2].toLowerCase()];
  // "x 5" with nothing after it means days.
  const bare = text.match(/(?:\bx|×)\s*(\d{1,3})\s*(?:$|[),;])/i);
  return bare ? Number(bare[1]) : undefined;
}

function readFood(text: string): FoodRelation | undefined {
  if (/\b(before (food|meals?|breakfast|lunch|dinner)|empty stomach|bbf|ac)\b/i.test(text)) return 'before_food';
  if (/\b(after (food|meals?|breakfast|lunch|dinner)|post (lunch|dinner|meals?)|abf|pc)\b/i.test(text)) return 'after_food';
  if (/\bwith (food|meals?|breakfast|lunch|dinner|milk)\b/i.test(text)) return 'with_food';
  return undefined;
}

function readDose(text: string): string | undefined {
  const t = text.trim();
  if (/^apply\b/i.test(t)) return 'Apply';
  const m = t.match(/^(\d+(?:\.\d+)?|½|half|one|two)\s*(tablets?|tabs?|capsules?|caps?|ml|tsp|spoons?|drops?|puffs?)\b/i);
  if (!m) return undefined;
  const raw = m[1].toLowerCase();
  const n = raw === '½' || raw === 'half' || raw === '0.5' ? 0.5 : raw === 'one' ? 1 : raw === 'two' ? 2 : Number(raw);
  const unit = m[2].toLowerCase();
  if (/^tab/.test(unit)) return n === 0.5 ? 'Half tablet' : `${n} tablet${n === 1 ? '' : 's'}`;
  if (/^cap/.test(unit)) return `${n} capsule${n === 1 ? '' : 's'}`;
  if (unit === 'ml') return `${n} ml`;
  if (unit === 'tsp' || /^spoon/.test(unit)) return `${n} spoon${n === 1 ? '' : 's'}`;
  if (/^drop/.test(unit)) return `${n} drop${n === 1 ? '' : 's'}`;
  return `${n} puff${n === 1 ? '' : 's'}`;
}

export function readInstructions(text: string): InstructionHints {
  return { days: readDays(text), food: readFood(text), dose: readDose(text) };
}

/** The reader's category (a fixed list in medicineExtractor) in words Saathi can say; unknown ones get nothing. */
const PURPOSE_BY_CATEGORY: Record<string, string> = {
  'Antibiotic': 'for infection',
  'Pain & Swelling Reduction': 'for pain and swelling',
  'Anti-inflammatory Enzyme': 'for swelling',
  'Antipyretic / Analgesic': 'for fever or pain',
  'Gastroprotection / Acidity': 'for acidity',
  'GERD & Acidity': 'for acidity',
  'Blood Pressure / ARB': 'for BP',
  'Blood Pressure': 'for BP',
  'Cholesterol': 'for cholesterol',
  'Blood Thinner': 'to keep the blood thin',
  'Cardiology': 'for the heart',
  'Diabetes Type 2': 'for sugar',
  'Diabetes': 'for sugar',
  'Thyroid': 'for thyroid',
  'Bone Health / Calcium': 'for the bones',
  'Nerve Health / Vitamins': 'for the nerves',
  'Laxative / Digestive': 'for easy motions',
  'Topical Antibacterial': 'for the wound'
};

/** The reader's category as a nickname the family approves or edits ("Pantoprazole" → "Gas tablet", what Indian families call acidity tablets). */
const NICKNAME_BY_CATEGORY: Record<string, string> = {
  'Antibiotic': 'Antibiotic tablet',
  'Pain & Swelling Reduction': 'Pain tablet',
  'Anti-inflammatory Enzyme': 'Swelling tablet',
  'Antipyretic / Analgesic': 'Fever tablet',
  'Gastroprotection / Acidity': 'Gas tablet',
  'GERD & Acidity': 'Gas tablet',
  'Blood Pressure / ARB': 'BP tablet',
  'Blood Pressure': 'BP tablet',
  'Cholesterol': 'Cholesterol tablet',
  'Blood Thinner': 'Blood thinner',
  'Cardiology': 'Heart tablet',
  'Diabetes Type 2': 'Sugar tablet',
  'Diabetes': 'Sugar tablet',
  'Thyroid': 'Thyroid tablet',
  'Bone Health / Calcium': 'Calcium tablet',
  'Nerve Health / Vitamins': 'Vitamin tablet',
  'Laxative / Digestive': 'Laxative',
  'Topical Antibacterial': 'Wound ointment',
  'Topical Application': 'Ointment'
};

/** "BP tablet" for a capsule or syrup reads "BP capsule" / "BP syrup". */
function nicknameFor(c: ExtractedMedicineCandidate): string | undefined {
  const base = c.category ? NICKNAME_BY_CATEGORY[c.category] : undefined;
  if (!base) return undefined;
  if (c.form === 'capsule') return base.replace(/\btablet$/, 'capsule');
  if (c.form === 'syrup') return base.replace(/\btablet$/, 'syrup');
  return base;
}

/**
 * Common Indian generics and brands -> the everyday name ("TAB. ZITEN M 20/500MG" -> "Sugar tablet").
 * ponytail: hand list of the usual ones; a miss just means no suggestion, the family types their own.
 */
const NICKNAME_BY_NAME: [RegExp, string][] = [
  [/insulin|glargine|lispro|degludec|lantus|basalog|mixtard|huminsulin|novomix|humalog|novorapid|tresiba|ryzodeg/, 'Insulin'],
  [/inhaler|rotacap|salbutamol|levosalbutamol|budesonide|formoterol|tiotropium|asthalin|levolin|budecort|foracort|seroflo|duolin|tiova/, 'Inhaler'],
  [/eye drop|timolol|latanoprost|brimonidine|travoprost|moxifloxacin eye|refresh tears|lubrex/, 'Eye drops'],
  [/isosorbide|nitroglycerin|ranolazine|ivabradine|trimetazidine|digoxin|sacubitril|sorbitrate|nikoran|nicorandil|ranozex|ivabrad|flavedon|vymada|carvedilol|cardivas/, 'Heart tablet'],
  [/metformin|glimepiride|gliclazide|glipizide|teneligliptin|vildagliptin|sitagliptin|linagliptin|dapagliflozin|empagliflozin|voglibose|pioglitazone|glycomet|ziten|tenepride|galvus|janumet|januvia|jalra|istavel|trajenta|amaryl|gemer|glimy|zoryl|forxiga|jardiance|gluconorm|glyciphage|zita|dynaglipt|vildapride|volix|oxra|sitaglyn|glizid|reclide/, 'Sugar tablet'],
  [/amlodipine|telmisartan|losartan|olmesartan|valsartan|metoprolol|atenolol|nebivolol|bisoprolol|cilnidipine|ramipril|enalapril|chlorthalidone|hydrochlorothiazide|\bmet xl\b|telma|amlong|stamlo|amlokind|losar|repace|olmezest|nebicard|concor|cilacar|prolomet|seloken|aten\b|tenormin|telvas|telsartan|cardace|arkamin|clonidine|prazosin|minipress|olmat|benitec|nexovas|azilsartan/, 'BP tablet'],
  [/atorvastatin|rosuvastatin|fenofibrate|rosuva|rozavel|rozucor|atorva|lipvas|storvas|tonact|lipicard/, 'Cholesterol tablet'],
  [/pantoprazole|rabeprazole|omeprazole|esomeprazole|famotidine|ranitidine|sucralfate|domperidone|\bpan\b|pan-?d|pan ?40|pantocid|razo|rabekind|omez|nexpro|sucrafil|digene|gelusil|mucaine/, 'Gas tablet'],
  [/levothyroxine|thyronorm|eltroxin|thyrox|lethyrox/, 'Thyroid tablet'],
  [/aspirin|clopidogrel|ticagrelor|warfarin|apixaban|rivaroxaban|ecosprin|clopilet|deplatt|brilinta|eliquis|xarelto/, 'Blood thinner'],
  [/hydroxyzine|cetirizine|levocetirizine|fexofenadine|montelukast|chlorpheniramine|atarax|okacet|allegra|montair|levocet|avil/, 'Allergy tablet'],
  [/paracetamol|dolo|calpol|crocin/, 'Fever tablet'],
  [/diclofenac|aceclofenac|ibuprofen|etoricoxib|tramadol|zerodol|voveran|hifenac|combiflam|ultracet/, 'Pain tablet'],
  [/amoxicillin|clavulan|azithromycin|cefixime|cefuroxime|ciprofloxacin|ofloxacin|levofloxacin|doxycycline|metronidazole|augmentin|azee|azithral|taxim|zifi|ciplox|oflox/, 'Antibiotic tablet'],
  [/calcium|shelcal|ccm\b|calcimax/, 'Calcium'],
  [/neurobion|becosules|methylcobalamin|cholecalciferol|vitamin|uprise|\bd3\b|zincovit|supradyn/, 'Vitamin'],
  [/ferrous|iron|livogen|orofer|dexorange/, 'Iron tablet'],
  [/zolpidem|alprazolam|clonazepam|lorazepam|melatonin|restyl|zapiz|nitrest/, 'Sleep tablet'],
  [/febuxostat|allopurinol|zyloric|febutaz/, 'Uric acid tablet'],
  [/tamsulosin|silodosin|dutasteride|urimax|veltam|silodal/, 'Prostate tablet'],
  [/lactulose|duphalac|isabgol|bisacodyl|dulcolax|cremaffin/, 'Constipation tablet']
];

/** The everyday nickname for a prescription name, as a capsule or syrup when it is one; undefined when unknown. */
export function nicknameFromName(name: string | null | undefined): string | undefined {
  const lower = (name || '').toLowerCase();
  if (!lower.trim()) return undefined;
  const base = NICKNAME_BY_NAME.find(([re]) => re.test(lower))?.[1];
  if (!base || !/tablet$/.test(base)) return base;
  if (/^\s*cap\b|capsule/.test(lower)) return base.replace(/tablet$/, 'capsule');
  if (/^\s*(syp|syr|gel|susp)\b|syrup|suspension/.test(lower)) return base.replace(/tablet$/, 'syrup');
  return base;
}

/**
 * Gives every draft row a nickname to approve: the category's ("BP tablet"), else the medicine's own name.
 * Each must be unique, so a second "BP tablet" becomes "Night BP tablet" (its first time), then "BP tablet 2".
 */
export function withNicknames(rows: ExtractedMedicineCandidate[], takenNames: string[] = []): ExtractedMedicineCandidate[] {
  const taken = [...takenNames];
  return rows.map(c => {
    const known = nicknameFor(c) || nicknameFromName(c.name);
    const wanted = known || cleanMedicineNameForSpeech(c.name.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim());
    const nickname = wanted ? freeNickname(wanted, c.timingSlots?.length ? c.timingSlots : [c.timeOfDay], taken) : '';
    if (nickname) taken.push(nickname);
    return { ...c, nickname, suggestedNickname: !!known };
  });
}

/**
 * Fills a fresh draft row from its instruction line. Only empty fields are filled (the reader's own
 * times and food win); short courses are set, longer ones only suggested; the purpose is only suggested.
 */
export function fillFromInstructions(c: ExtractedMedicineCandidate): ExtractedMedicineCandidate {
  const text = c.dosage || '';
  const hints = readInstructions(text);
  const out: ExtractedMedicineCandidate = { ...c, autoFilled: [] };
  if (hints.days && hints.days <= AUTO_COURSE_MAX_DAYS) {
    out.courseDays = hints.days;
    out.autoFilled!.push('days');
  } else if (hints.days) {
    out.suggestedDays = hints.days;
  }
  if (hints.food && (!c.foodRelation || c.foodRelation === 'not_specified')) {
    out.foodRelation = hints.food;
    out.autoFilled!.push('food');
  }
  if (hints.dose && hints.dose !== text.trim()) {
    out.dosage = hints.dose;
    out.prescriptionText = text.trim();
    out.autoFilled!.push('dose');
  }
  const purpose = c.category ? PURPOSE_BY_CATEGORY[c.category] : undefined;
  if (purpose) out.suggestedPurpose = purpose;
  return out;
}
