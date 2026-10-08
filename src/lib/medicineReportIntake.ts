import { ExtractedMedicineCandidate } from './types';
import { extractMedicinesWithGroqVision, getGroqVisionModel } from './groqVision';
import { extractMedicinesFromText, SAMPLE_PRESCRIPTIONS } from './medicineExtractor';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

/** Prescription photos one person may have read per hour (each is a paid vision request). */
export const EXTRACTIONS_PER_HOUR = 20;

export interface IntakeResult {
  ok: true;
  fileName: string;
  fileType: string;
  parentId?: string;
  extractedMedicines: ExtractedMedicineCandidate[];
  batchConfidence: 'high' | 'medium' | 'low';
  batchQualityWarning?: string;
  detectedCount: number;
  modelUsed: string;
}

export interface IntakeError {
  ok: false;
  status: number;
  error: string;
}

/**
 * Parses an upload request (multipart or JSON) and runs extraction.
 * The result is always a DRAFT for the user to review; nothing is saved to
 * the parent's medicines here.
 *
 * If the document can't be read, this returns an error. It never substitutes
 * example medicines: a sample list shown as a real parent's draft could be
 * confirmed by mistake.
 */
export async function extractFromRequest(req: Request): Promise<IntakeResult | IntakeError> {
  const contentType = req.headers.get('content-type') || '';

  let fileName = 'Prescription';
  let fileType = 'application/octet-stream';
  let parentId: string | undefined;
  let sampleId: string | null = null;
  let imageBase64: string | null = null;
  let rawText: string | null = null;

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    sampleId = (formData.get('sampleId') as string | null) || null;
    parentId = (formData.get('parentId') as string | null) || undefined;

    if (file) {
      if (file.size > MAX_UPLOAD_BYTES) {
        return { ok: false, status: 413, error: 'File is too large. Please upload a file under 8 MB.' };
      }
      fileName = file.name;
      fileType = file.type || 'application/octet-stream';

      if (fileType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        // The vision model reads images only; a PDF would silently fail.
        return { ok: false, status: 415, error: 'PDF reading is not supported yet. Please upload a photo or screenshot of the prescription.' };
      }
      if (fileType.includes('text') || file.name.endsWith('.txt') || file.name.endsWith('.csv')) {
        rawText = await file.text();
      } else if (ALLOWED_IMAGE_TYPES.includes(fileType)) {
        imageBase64 = Buffer.from(await file.arrayBuffer()).toString('base64');
      } else {
        return { ok: false, status: 415, error: 'Unsupported file type. Please upload a photo (JPG, PNG, WebP) or a text file.' };
      }
    }
  } else {
    const body = await req.json().catch(() => ({}));
    fileName = body.fileName || fileName;
    fileType = body.fileType || fileType;
    parentId = body.parentId || undefined;
    sampleId = body.sampleId || body.samplePreset || null;
    imageBase64 = body.imageBase64 || null;
    rawText = body.text || null;
  }

  // Explicitly chosen demo sample (labelled as such in the UI).
  if (sampleId) {
    const sample = SAMPLE_PRESCRIPTIONS.find(s => s.id === sampleId);
    if (!sample) {
      return { ok: false, status: 404, error: 'Sample prescription not found.' };
    }
    return {
      ok: true,
      fileName: `${sample.title.replace(/[^a-zA-Z0-9]/g, '_')} (sample)`,
      fileType: 'sample',
      parentId,
      extractedMedicines: sample.extractedResults,
      batchConfidence: 'high',
      batchQualityWarning: 'These are example medicines from a sample prescription, not your parent\'s.',
      detectedCount: sample.extractedResults.length,
      modelUsed: 'clinical_preset'
    };
  }

  if (imageBase64) {
    const groqResult = await extractMedicinesWithGroqVision({ imageBase64, mimeType: fileType });
    if (!groqResult.success) {
      console.warn(`[medicine intake] Vision extraction failed: ${groqResult.error}`);
      return {
        ok: false,
        status: 502,
        error: "We couldn't read this document. Please try a clearer, well-lit photo, or enter the medicines manually."
      };
    }
    return {
      ok: true,
      fileName,
      fileType,
      parentId,
      extractedMedicines: groqResult.extractedMedicines,
      batchConfidence: groqResult.batchConfidence,
      batchQualityWarning: groqResult.batchQualityWarning,
      detectedCount: groqResult.detectedCount,
      modelUsed: groqResult.modelUsed || getGroqVisionModel()
    };
  }

  if (rawText && rawText.trim()) {
    const textRes = extractMedicinesFromText(rawText);
    return {
      ok: true,
      fileName,
      fileType,
      parentId,
      extractedMedicines: textRes.extractedMedicines,
      batchConfidence: textRes.batchConfidence,
      batchQualityWarning: textRes.batchQualityWarning,
      detectedCount: textRes.detectedCount,
      modelUsed: 'clinical_text_parser'
    };
  }

  return { ok: false, status: 400, error: 'Please upload a prescription photo or text file.' };
}
