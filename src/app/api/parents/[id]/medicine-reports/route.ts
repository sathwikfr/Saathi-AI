import { NextResponse } from 'next/server';
import { getMedicineReportsForParent, createMedicineReport } from '@/lib/db';
import { requireParentAccess } from '@/lib/access';
import { extractFromRequest } from '@/lib/medicineReportIntake';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireParentAccess(id, 'view');
  if (!access.ok) return access.response;

  const reports = await getMedicineReportsForParent(id);
  return NextResponse.json({ reports });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireParentAccess(id, 'manage');
  if (!access.ok) return access.response;

  try {
    const result = await extractFromRequest(req);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const report = await createMedicineReport({
      parentId: id,
      userId: access.user.id,
      fileName: result.fileName,
      fileType: result.fileType,
      rawExtractionJson: result.extractedMedicines,
      batchConfidence: result.batchConfidence,
      batchQualityWarning: result.batchQualityWarning
    });

    return NextResponse.json({
      success: true,
      reportId: report.id,
      fileName: result.fileName,
      extractedMedicines: result.extractedMedicines,
      batchConfidence: result.batchConfidence,
      batchQualityWarning: result.batchQualityWarning,
      detectedCount: result.detectedCount,
      modelUsed: result.modelUsed
    });
  } catch (err) {
    console.error('Parent medicine report error:', err);
    return NextResponse.json({ error: 'Failed to extract medicines. You can add them manually.' }, { status: 500 });
  }
}
