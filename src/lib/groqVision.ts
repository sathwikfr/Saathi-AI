import { ExtractedMedicineCandidate, MedicineTimingSlot, FoodRelation } from './types';
import { COMMON_MEDICATIONS_DB, isValidMedicineName } from './medicineExtractor';

export function getGroqApiKey(): string {
  return process.env.GROQ_API_KEY || '';
}

export function getGroqVisionModel(): string {
  return process.env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b';
}

export interface GroqExtractionOutput {
  success: boolean;
  extractedMedicines: ExtractedMedicineCandidate[];
  batchConfidence: 'high' | 'medium' | 'low';
  batchQualityWarning?: string;
  detectedCount: number;
  rawModelResponse?: string;
  modelUsed: string;
  error?: string;
}

interface RawGroqMedicine {
  name?: string;
  dosage?: string;
  timing_slots?: string[] | string;
  timing?: string;
  food_relation?: 'before_food' | 'after_food' | 'with_food' | 'not_specified' | string;
  confidence?: 'high' | 'low' | string;
}

const EXTRACTION_SYSTEM_PROMPT = `You are extracting medicine information from a prescription image for a medical reminder app. Look at the image carefully and extract ONLY the medicines that are clearly written.

Return ONLY valid JSON in this exact structure, with no other text:
{
  "medicines": [
    {
      "name": "string - medicine name as written",
      "dosage": "string - dosage/instructions as written, or empty string if not visible",
      "timing_slots": ["morning", "bedtime"],
      "food_relation": "before_food" | "after_food" | "with_food" | "not_specified",
      "confidence": "high" | "low"
    }
  ]
}

Important Instructions for Indian Prescription Dosage & Timing:
- Many Indian prescriptions use dosage shorthand in the format X-Y-Z, where X = morning dose, Y = afternoon dose, Z = night dose, and 1 = take, 0 = skip (e.g. "1-0-1" means take in the morning and at night, skip afternoon; "1-1-1" means morning, afternoon, night; "0-0-1" means night/bedtime only; "1-0-0" means morning only).
- For each medicine, if this shorthand or standard clinical abbreviations (BD, TDS, OD, HS, QID) are present in the dosage instructions, return a "timing_slots" array listing ALL applicable slots:
  - "morning"
  - "afternoon"
  - "evening"
  - "bedtime"
  - "as_needed"
  - "unspecified"
- Examples:
  - "1-0-1" or "1 tab BD" -> ["morning", "bedtime"]
  - "1-1-1" or "1 tab TDS" -> ["morning", "afternoon", "bedtime"]
  - "1-0-0" or "1 tab OD BBF" -> ["morning"]
  - "0-0-1" or "1 tab HS" -> ["bedtime"]
  - "0-1-0" or "after lunch" -> ["afternoon"]
- For topical applications, ointments, creams, gels, lotions, ear/eye drops, or items with no meal-based schedule (or SOS / PRN / as needed), return timing_slots as ["as_needed"] rather than defaulting to "morning".

Important Instructions for Food Relation (Before vs After Food):
- For each medicine, determine its relationship to food from the dosage instructions, if stated:
  - "before_food" (e.g. "before breakfast", "empty stomach", "OD BBF", "30 mins before meals")
  - "after_food" (e.g. "after meals", "after breakfast", "after dinner", "post lunch", "ABF", "after food")
  - "with_food" (e.g. "with meals", "with breakfast", "with food")
  - "not_specified" (if not stated, or for bedtime-only medicines, or for topical ointments/creams/drops)

Rules:
- If handwriting is illegible or you are not confident about a medicine name, still include it but set confidence to "low" — do not guess or invent a plausible-sounding name.
- Do not split a single medicine into multiple entries.
- Do not include the doctor's name, patient details, dates, or diagnosis notes as medicines.
- If you cannot identify ANY medicines in the image, return {"medicines": []}.
- Do not output any text before or after the JSON object.`;

/**
 * Parses dosage shorthand or timing array into validated MedicineTimingSlot[]
 */
export function normalizeTimingSlots(
  rawSlots?: string[] | string,
  dosage?: string,
  name?: string
): MedicineTimingSlot[] {
  const combined = `${name || ''} ${dosage || ''}`.toLowerCase();

  // 1. Check for explicit shorthand pattern in dosage / name: X-Y-Z
  if (/\b1\s*[-–—]\s*0\s*[-–—]\s*1\b/.test(combined)) {
    return ['morning', 'bedtime'];
  }
  if (/\b1\s*[-–—]\s*1\s*[-–—]\s*1\b/.test(combined)) {
    return ['morning', 'afternoon', 'bedtime'];
  }
  if (/\b0\s*[-–—]\s*0\s*[-–—]\s*1\b/.test(combined)) {
    return ['bedtime'];
  }
  if (/\b1\s*[-–—]\s*0\s*[-–—]\s*0\b/.test(combined)) {
    return ['morning'];
  }
  if (/\b0\s*[-–—]\s*1\s*[-–—]\s*0\b/.test(combined)) {
    return ['afternoon'];
  }
  if (/\b1\s*[-–—]\s*1\s*[-–—]\s*0\b/.test(combined)) {
    return ['morning', 'afternoon'];
  }
  if (/\b0\s*[-–—]\s*1\s*[-–—]\s*1\b/.test(combined)) {
    return ['afternoon', 'bedtime'];
  }

  // 2. Check for topical / as-needed formulations
  if (/\b(oint|ointment|gel|cream|ruie|topical|lotion|drops|sos|prn|as needed|when required)\b/.test(combined)) {
    return ['as_needed'];
  }

  // 3. Clinical abbreviations
  if (/\b(bd|b\.d\.|bid|twice\s*daily|morning\s*(&|and)\s*night)\b/.test(combined)) {
    return ['morning', 'bedtime'];
  }
  if (/\b(tds|t\.d\.s\.|tid|thrice\s*daily|3\s*times)\b/.test(combined)) {
    return ['morning', 'afternoon', 'bedtime'];
  }
  if (/\b(hs|h\.s\.|bedtime|night|before\s*sleep)\b/.test(combined)) {
    return ['bedtime'];
  }
  if (/\b(afternoon|lunch|post\s*lunch|noon)\b/.test(combined)) {
    return ['afternoon'];
  }
  if (/\b(evening|dinner|post\s*dinner)\b/.test(combined)) {
    return ['evening'];
  }
  if (/\b(od|o\.d\.|bbf|morning|breakfast|empty\s*stomach)\b/.test(combined)) {
    return ['morning'];
  }

  // 4. If rawSlots provided from model
  if (Array.isArray(rawSlots) && rawSlots.length > 0) {
    const parsed: MedicineTimingSlot[] = [];
    for (const s of rawSlots) {
      const lower = String(s).toLowerCase().trim();
      if (lower.includes('night') || lower.includes('bedtime') || lower.includes('hs')) parsed.push('bedtime');
      else if (lower.includes('afternoon') || lower.includes('lunch')) parsed.push('afternoon');
      else if (lower.includes('evening') || lower.includes('dinner')) parsed.push('evening');
      else if (lower.includes('morning') || lower.includes('breakfast')) parsed.push('morning');
      else if (lower.includes('as_needed') || lower.includes('sos')) parsed.push('as_needed');
    }
    if (parsed.length > 0) {
      return Array.from(new Set(parsed));
    }
  }

  if (typeof rawSlots === 'string' && rawSlots.trim()) {
    const lower = rawSlots.toLowerCase();
    if (lower.includes('night') || lower.includes('bedtime') || lower.includes('hs')) return ['bedtime'];
    if (lower.includes('afternoon') || lower.includes('lunch')) return ['afternoon'];
    if (lower.includes('evening') || lower.includes('dinner')) return ['evening'];
    if (lower.includes('as_needed') || lower.includes('sos')) return ['as_needed'];
    if (lower.includes('morning')) return ['morning'];
  }

  return ['morning'];
}

/**
 * Normalizes primary timing string from slots for backwards compatibility
 */
function primarySlotFromSlots(slots: MedicineTimingSlot[]): 'morning' | 'afternoon' | 'evening' | 'bedtime' {
  if (slots.includes('morning')) return 'morning';
  if (slots.includes('afternoon')) return 'afternoon';
  if (slots.includes('evening')) return 'evening';
  if (slots.includes('bedtime')) return 'bedtime';
  return 'morning';
}

/**
 * Infers medicine formulation (tablet, capsule, syrup, ointment, drops, etc.)
 */
function inferForm(name: string, dosage: string): 'tablet' | 'capsule' | 'syrup' | 'ointment' | 'drops' | 'injection' | 'other' {
  const combined = `${name} ${dosage}`.toLowerCase();
  if (/\b(oint|ointment|gel|cream|ruie|mupirocin|topical)\b/.test(combined)) return 'ointment';
  if (/\b(cap|capsule)\b/.test(combined)) return 'capsule';
  if (/\b(syp|syrup|suspension|duphalac)\b/.test(combined)) return 'syrup';
  if (/\b(drops|eye drops|ear drops)\b/.test(combined)) return 'drops';
  if (/\b(inj|injection)\b/.test(combined)) return 'injection';
  return 'tablet';
}

/**
 * Matches extracted medicine name against known Indian formulary for canonical enrichment
 */
function matchKnownFormulary(name: string) {
  const lower = name.toLowerCase();
  for (const med of COMMON_MEDICATIONS_DB) {
    const brandPrefix = med.name.toLowerCase().split(' ')[0];
    if (lower.includes(brandPrefix) || lower.includes(med.name.toLowerCase())) {
      return med;
    }
  }
  return null;
}

/**
 * Extracts structured medicines from a prescription image using Groq Vision API
 */
export async function extractMedicinesWithGroqVision({
  imageBase64,
  mimeType = 'image/png'
}: {
  imageBase64: string;
  mimeType?: string;
}): Promise<GroqExtractionOutput> {
  const apiKey = getGroqApiKey();
  const model = getGroqVisionModel();

  if (!apiKey) {
    return {
      success: false,
      extractedMedicines: [],
      batchConfidence: 'low',
      batchQualityWarning: 'Groq API Key is not configured in environment.',
      detectedCount: 0,
      modelUsed: model,
      error: 'Missing GROQ_API_KEY'
    };
  }

  // Format Base64 image URL for Groq Vision API
  const formattedImageUrl = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:${mimeType};base64,${imageBase64}`;

  console.log(`[Aaptha Groq Vision] Dispatched image to model "${model}"...`);

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: EXTRACTION_SYSTEM_PROMPT },
              { type: 'image_url', image_url: { url: formattedImageUrl } }
            ]
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 1500
      })
    });

    const responseData = await response.json();

    if (!response.ok) {
      const errMsg = responseData.error?.message || `Groq API Error (${response.status})`;
      console.error(`[Aaptha Groq Vision] API Error (HTTP ${response.status}): ${errMsg}`);
      return {
        success: false,
        extractedMedicines: [],
        batchConfidence: 'low',
        batchQualityWarning: `Vision model error: ${errMsg}`,
        detectedCount: 0,
        modelUsed: model,
        error: errMsg
      };
    }

    const rawContent = responseData.choices?.[0]?.message?.content || '{}';
    console.log(`[Aaptha Groq Vision] Model replied (${String(rawContent).length} characters; text not logged, it is medical data)`);

    // Parse JSON
    let parsed: { medicines?: RawGroqMedicine[] } = {};
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      console.error('[Aaptha Groq Vision] Failed to parse JSON from model output');
      return {
        success: false,
        extractedMedicines: [],
        batchConfidence: 'low',
        batchQualityWarning: "We couldn't parse the doctor's prescription clearly. Please check the image or add manually.",
        detectedCount: 0,
        modelUsed: model,
        rawModelResponse: rawContent,
        error: 'Invalid JSON response from vision model'
      };
    }

    const rawMedicines = parsed.medicines || [];

    if (rawMedicines.length === 0) {
      return {
        success: true,
        extractedMedicines: [],
        batchConfidence: 'high',
        batchQualityWarning: "No medicines were detected in this image. If this is a prescription, please ensure good lighting or enter manually.",
        detectedCount: 0,
        modelUsed: model,
        rawModelResponse: rawContent
      };
    }

    // Server-side Validation & Normalization Rules
    const validatedCandidates: ExtractedMedicineCandidate[] = [];
    let lowConfidenceCount = 0;

    for (let i = 0; i < rawMedicines.length; i++) {
      const raw = rawMedicines[i];
      if (!raw || !raw.name) continue;

      const rawName = String(raw.name).trim();
      const rawDosage = raw.dosage ? String(raw.dosage).trim() : '';

      // 1. Strict Name Validation Check
      const validation = isValidMedicineName(rawName);
      if (!validation.valid) {
        console.warn(`[Aaptha Groq Vision] Filtered out an invalid medicine name: ${validation.reason}`);
        continue;
      }

      // 2. Determine confidence
      let confidence: 'high' | 'medium' | 'low' = raw.confidence === 'low' ? 'low' : 'high';
      let flagReason: string | undefined = undefined;

      // Legibility / character check: if name contains suspicious symbols or is very short
      const alphaCount = (rawName.match(/[a-zA-Z]/g) || []).length;
      if (alphaCount / rawName.length < 0.7 || rawName.length < 4) {
        confidence = 'low';
        flagReason = 'Unusual spelling or partially unclear handwriting — please double check';
      }

      // Parse timing slots and frequency
      const timingSlots = normalizeTimingSlots(raw.timing_slots || raw.timing, rawDosage, rawName);
      const isAsNeeded = timingSlots.includes('as_needed');

      let frequency: 'daily' | 'twice_daily' | 'as_needed' = 'daily';
      if (isAsNeeded) {
        frequency = 'as_needed';
        if (confidence !== 'low') {
          confidence = 'medium';
        }
        flagReason = 'As-needed (SOS) medicine — alerts trigger only if symptoms reported';
      } else if (timingSlots.length >= 2) {
        frequency = 'twice_daily';
      }

      // 3. Infer Food Relation (before_food, after_food, with_food, not_specified)
      let foodRelation: FoodRelation = 'not_specified';
      const rawRel = typeof raw.food_relation === 'string' ? raw.food_relation.toLowerCase().trim() : '';
      if (rawRel === 'before_food' || rawRel === 'after_food' || rawRel === 'with_food' || rawRel === 'not_specified') {
        foodRelation = rawRel as FoodRelation;
      } else {
        // Fallback inference from dosage text and drug pharmacokinetics
        const combinedText = `${rawName} ${rawDosage}`.toLowerCase();
        if (/\b(before\s*food|before\s*meals?|before\s*breakfast|empty\s*stomach|bbf|a\.?c\.?|30\s*(mins?|minutes?)\s*before)\b/i.test(combinedText)) {
          foodRelation = 'before_food';
        } else if (/\b(after\s*food|after\s*meals?|after\s*breakfast|after\s*lunch|after\s*dinner|post\s*meals?|post\s*lunch|post\s*breakfast|post\s*dinner|p\.?c\.?|abf)\b/i.test(combinedText)) {
          foodRelation = 'after_food';
        } else if (/\b(with\s*food|with\s*meals?|with\s*breakfast|with\s*lunch|with\s*dinner)\b/i.test(combinedText)) {
          foodRelation = 'with_food';
        } else {
          // Known formulary defaults
          if (/\b(pantoprazole|pan-40|pan-d|omeprazole|rabeprazole|esomeprazole|thyronorm|eltroxin|levothyroxine)\b/i.test(rawName)) {
            foodRelation = 'before_food';
          } else if (/\b(augmentin|trypsy|amoxicillin|cefixime|telmisartan|telma|shelcal|ecosprin|aspirin|ibuprofen|paracetamol|dolo|cardivas|carvedilol|neurobion)\b/i.test(rawName)) {
            foodRelation = 'after_food';
          } else if (/\b(metformin|glycomet|glimepiride)\b/i.test(rawName)) {
            foodRelation = 'with_food';
          }
        }
      }

      const form = inferForm(rawName, rawDosage);

      // If topical / ointment, always not_specified
      if (form === 'ointment' || form === 'drops') {
        foodRelation = 'not_specified';
      }

      // 4. Enrich with known formulary & form
      const matched = matchKnownFormulary(rawName);
      const category = matched ? matched.category : (form === 'ointment' ? 'Topical Application' : undefined);

      if (matched && confidence !== 'low') {
        confidence = 'high';
      }

      if (confidence === 'low') {
        lowConfidenceCount++;
      }

      validatedCandidates.push({
        id: `groq_${Date.now()}_${i}`,
        name: rawName,
        dosage: rawDosage || (form === 'ointment' ? 'Apply twice daily on affected area' : '1 tablet daily'),
        timeOfDay: primarySlotFromSlots(timingSlots),
        timingSlots,
        foodRelation,
        frequency,
        form,
        category,
        confidence,
        flagReason,
        // Safety rule: low-confidence items start unselected
        selected: confidence !== 'low'
      });

      // Sanity cap: max 10 medicines per prescription slip
      if (validatedCandidates.length >= 10) {
        break;
      }
    }

    // 4. Batch Confidence & Anomaly Detection
    let batchConfidence: 'high' | 'medium' | 'low' = 'high';
    let batchQualityWarning: string | undefined = undefined;

    if (rawMedicines.length > 8 || lowConfidenceCount >= 2 || (validatedCandidates.length > 0 && lowConfidenceCount / validatedCandidates.length > 0.4)) {
      batchConfidence = 'low';
      batchQualityWarning = 'We detected uncertain handwriting or multiple ambiguous items on this prescription. Low-confidence rows are flagged in amber and start unselected for safety. Please review each medicine before confirming.';
      // Mark all as low confidence if count exceeds reasonable single-slip threshold
      if (rawMedicines.length > 8) {
        for (const item of validatedCandidates) {
          item.confidence = 'low';
          item.selected = false;
        }
      }
    }

    return {
      success: true,
      extractedMedicines: validatedCandidates,
      batchConfidence,
      batchQualityWarning,
      detectedCount: validatedCandidates.length,
      rawModelResponse: rawContent,
      modelUsed: model
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Aaptha Groq Vision] Execution Exception:`, errMsg);
    return {
      success: false,
      extractedMedicines: [],
      batchConfidence: 'low',
      batchQualityWarning: `Failed to connect to Groq Vision: ${errMsg}`,
      detectedCount: 0,
      modelUsed: model,
      error: errMsg
    };
  }
}
