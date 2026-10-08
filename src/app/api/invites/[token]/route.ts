import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { getInvitePreview, acceptInvite } from '@/lib/familyInvites';
import { consumeRateLimit } from '@/lib/security';

type Ctx = { params: Promise<{ token: string }> };

/** Who invited you to look after whom (no other details before accepting). */
export async function GET(req: Request, { params }: Ctx) {
  const { token } = await params;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!consumeRateLimit(`invite-view:${ip}`, 30, 60 * 60 * 1000).allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }
  const preview = await getInvitePreview(token);
  if (!preview) return NextResponse.json({ error: 'This invite link has already been used or was cancelled.' }, { status: 404 });
  return NextResponse.json(preview);
}

/** Accept: the logged-in account joins the family circle. */
export async function POST(req: Request, { params }: Ctx) {
  const { token } = await params;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const res = await acceptInvite(token, auth.user);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ success: true, parentId: res.parentId });
}
