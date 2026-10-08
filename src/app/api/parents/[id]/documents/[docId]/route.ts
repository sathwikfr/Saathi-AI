import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireParentAccess } from '@/lib/access';
import { getStorageConfig, signedUrl } from '@/lib/storage';

type Ctx = { params: Promise<{ id: string; docId: string }> };

/** A 5-minute link to open the file (after the access check). */
export async function GET(req: Request, { params }: Ctx) {
  const { id, docId } = await params;
  const access = await requireParentAccess(id, 'view');
  if (!access.ok) return access.response;
  const cfg = getStorageConfig();
  if (!cfg) return NextResponse.json({ error: 'The health record vault is not switched on yet.' }, { status: 503 });
  const doc = await prisma.healthDocument.findFirst({ where: { id: docId, parentId: id, isDeleted: false } });
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  try {
    return NextResponse.json({ url: await signedUrl(cfg, doc.storageKey) });
  } catch (err) {
    console.error('[vault] Signing failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not open the file right now.' }, { status: 502 });
  }
}

/** Edit the title, dates or notes. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id, docId } = await params;
  const access = await requireParentAccess(id, 'manage');
  if (!access.ok) return access.response;
  const body = await req.json().catch(() => ({}));
  const data: Record<string, string | null> = {};
  const date = (v: unknown) => (v === '' || v === null ? null : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  if (typeof body.title === 'string' && body.title.trim()) data.title = body.title.trim().slice(0, 160);
  if (body.notes !== undefined) data.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 500) : null;
  for (const k of ['docDate', 'renewalDate'] as const) {
    const v = date(body[k]);
    if (v !== undefined) data[k] = v;
  }
  const res = await prisma.healthDocument.updateMany({ where: { id: docId, parentId: id, isDeleted: false }, data });
  if (res.count !== 1) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}

/** Hide from the vault (soft delete; the file is kept, as with all family data). */
export async function DELETE(req: Request, { params }: Ctx) {
  const { id, docId } = await params;
  const access = await requireParentAccess(id, 'manage');
  if (!access.ok) return access.response;
  const res = await prisma.healthDocument.updateMany({ where: { id: docId, parentId: id }, data: { isDeleted: true } });
  if (res.count !== 1) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
