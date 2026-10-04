import { NextResponse } from 'next/server';
import { requireParentAccess } from '@/lib/access';
import { startPracticeAlert } from '@/lib/escalation';

type Ctx = { params: Promise<{ id: string }> };

/** A practice emergency call to one contact, so they know what a real one sounds like. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireParentAccess(id, 'manage');
  if (!access.ok) return access.response;

  const { contactId } = await req.json().catch(() => ({}));
  if (typeof contactId !== 'string') return NextResponse.json({ error: 'contactId is required' }, { status: 400 });

  const res = await startPracticeAlert({ parentId: id, contactId });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({
    success: true,
    message: 'Practice call placed. Their phone should ring in a moment; it says clearly that this is only practice.'
  });
}
