import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireParentAccess } from '@/lib/access';

type Ctx = { params: Promise<{ id: string; insightId: string }> };

/**
 * "Got it": hides a noticed pattern from the dashboard banner and the summaries (it stays in the history). It hides it
 * for the whole family, so it is for the owner and co-managers, like closing an alert.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id, insightId } = await params;
  const access = await requireParentAccess(id, 'manage');
  if (!access.ok) return access.response;
  const res = await prisma.healthInsight.updateMany({ where: { id: insightId, parentId: id, dismissedAt: null }, data: { dismissedAt: new Date() } });
  return NextResponse.json({ success: res.count === 1 });
}
