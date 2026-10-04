import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { newId } from '@/lib/db';
import { requireParentAccess } from '@/lib/access';
import { getStorageConfig, uploadObject, storageKeyFor, MAX_DOCUMENT_BYTES, ALLOWED_DOCUMENT_TYPES } from '@/lib/storage';
import { HealthDocument } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

const KINDS: HealthDocument['kind'][] = ['prescription', 'lab_report', 'scan', 'bill', 'discharge', 'insurance', 'other'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toDoc(d: Awaited<ReturnType<typeof prisma.healthDocument.findMany>>[number]): HealthDocument {
  return {
    id: d.id,
    parentId: d.parentId,
    kind: d.kind as HealthDocument['kind'],
    title: d.title,
    docDate: d.docDate || undefined,
    renewalDate: d.renewalDate || undefined,
    notes: d.notes || undefined,
    fileName: d.fileName,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    createdAt: d.createdAt.toISOString()
  };
}

/** The vault's list (titles and dates; files open through a short-lived signed link). */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireParentAccess(id, 'view');
  if (!access.ok) return access.response;
  const docs = await prisma.healthDocument.findMany({ where: { parentId: id, isDeleted: false }, orderBy: [{ docDate: 'desc' }, { createdAt: 'desc' }] });
  return NextResponse.json({ documents: docs.map(toDoc), enabled: !!getStorageConfig() });
}

/** Upload one file (multipart: file, kind, title, docDate?, renewalDate?, notes?). */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireParentAccess(id, 'manage');
  if (!access.ok) return access.response;
  const cfg = getStorageConfig();
  if (!cfg) return NextResponse.json({ error: 'The health record vault is not switched on yet.' }, { status: 503 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Please choose a file.' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'Please choose a file.' }, { status: 400 });
  if (file.size > MAX_DOCUMENT_BYTES) return NextResponse.json({ error: 'Files can be up to 10 MB.' }, { status: 413 });
  if (!ALLOWED_DOCUMENT_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Please upload a PDF or a photo (JPG, PNG, WEBP, HEIC).' }, { status: 415 });
  }
  const kind = String(form.get('kind') || 'other') as HealthDocument['kind'];
  const title = String(form.get('title') || '').trim().slice(0, 160) || file.name.slice(0, 160);
  const docDate = String(form.get('docDate') || '').trim();
  const renewalDate = String(form.get('renewalDate') || '').trim();
  const notes = String(form.get('notes') || '').trim().slice(0, 500);
  if (!KINDS.includes(kind)) return NextResponse.json({ error: 'Unknown document type.' }, { status: 400 });
  if ((docDate && !DATE_RE.test(docDate)) || (renewalDate && !DATE_RE.test(renewalDate))) {
    return NextResponse.json({ error: 'Dates must be YYYY-MM-DD.' }, { status: 400 });
  }

  const key = storageKeyFor(id, file.name, crypto.randomBytes(8).toString('hex'));
  try {
    await uploadObject(cfg, key, Buffer.from(await file.arrayBuffer()), file.type);
  } catch (err) {
    console.error('[vault] Upload failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'The file could not be saved. Please try again.' }, { status: 502 });
  }
  const doc = await prisma.healthDocument.create({
    data: {
      id: newId('doc'),
      parentId: id,
      uploadedById: access.user.id,
      kind,
      title,
      docDate: docDate || null,
      renewalDate: renewalDate || null,
      notes: notes || null,
      fileName: file.name.slice(0, 200),
      mimeType: file.type,
      sizeBytes: file.size,
      storageKey: key
    }
  });
  return NextResponse.json({ success: true, document: toDoc(doc) });
}
