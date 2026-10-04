import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireParentAccess } from '@/lib/access';

type Ctx = { params: Promise<{ id: string; insightId: string }> };

/** "Got it": hides a noticed pattern from the dashboard banner (it stays in the history). */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id, insightId } = await params;
  const access = await requireParentAccess(id, 'view');
  if (!access.ok) return access.response;
  const res = await prisma.healthInsight.updateMany({ where: { id: insightId, parentId: id, dismissedAt: null }, data: { dismissedAt: new Date() } });
  return NextResponse.json({ success: res.count === 1 });
}
