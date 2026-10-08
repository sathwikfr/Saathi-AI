import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { ownerView, memberView, setUpiId, setSharesBill, markSharePaid } from '@/lib/billShare';

/**
 * Siblings sharing the bill (Aaptha never holds the money):
 *   GET   your view as the payer (who shares, who paid this month) and as a member (what you owe)
 *   POST  { upiId }                       payer: where siblings pay
 *         { memberId, shares: boolean }   payer: who shares the bill
 *         { ownerId, paid: boolean }      member: "I've paid my share this month"
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const [asOwner, asMember] = await Promise.all([ownerView(auth.user.id), memberView(auth.user.id)]);
  return NextResponse.json({ asOwner, asMember });
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const b = await req.json().catch(() => ({}));

  if ('upiId' in b) {
    const res = await setUpiId(auth.user.id, typeof b.upiId === 'string' && b.upiId.trim() ? b.upiId : null);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  } else if (typeof b.memberId === 'string' && typeof b.shares === 'boolean') {
    if (!(await setSharesBill(auth.user.id, b.memberId, b.shares))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  } else if (typeof b.ownerId === 'string' && typeof b.paid === 'boolean') {
    const res = await markSharePaid(b.ownerId, auth.user.id, b.paid);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  } else {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const [asOwner, asMember] = await Promise.all([ownerView(auth.user.id), memberView(auth.user.id)]);
  return NextResponse.json({ success: true, asOwner, asMember });
}
