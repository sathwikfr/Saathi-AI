import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireParentAccess } from '@/lib/access';

type Ctx = { params: Promise<{ id: string }> };

/** Messages between the family and the parent. Saathi reads family messages out on the next call. */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireParentAccess(id, 'view');
  if (!access.ok) return access.response;
  const rows = await prisma.familyMessage.findMany({ where: { parentId: id, status: { not: 'cancelled' } }, orderBy: { createdAt: 'desc' }, take: 40 });
  return NextResponse.json({
    messages: rows.map(m => ({
      id: m.id, direction: m.direction, authorName: m.authorName, text: m.text, status: m.status,
      createdAt: m.createdAt.toISOString(), deliveredAt: m.deliveredAt?.toISOString(), mine: m.userId === access.user.id
    }))
  });
}

/**
 * Retired 2026-10-08 (the user: messages read out by Saathi can come between a parent and the family). Nothing is sent,
 * and nothing waiting is read out any more (the dispatcher no longer loads messages).
 */
export async function POST() {
  return NextResponse.json({ error: 'Messages read out by Saathi are no longer offered.', code: 'RETIRED' }, { status: 410 });
}

export async function DELETE() {
  return NextResponse.json({ error: 'Messages read out by Saathi are no longer offered.', code: 'RETIRED' }, { status: 410 });
}
