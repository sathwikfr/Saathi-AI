import { NextResponse } from 'next/server';
import { getCaregiversForParent } from '@/lib/db';
import { requireParentAccess } from '@/lib/access';
import { createInvite, revokeMember, setMemberRole, leaveParent, canEmailInvites } from '@/lib/familyInvites';

type Ctx = { params: Promise<{ id: string }> };

/**
 * The family circle for one parent.
 *   POST   (owner)  invite { name, email?, phone?, role } -> a link to share (emailed too once a domain is verified)
 *   PATCH  (owner)  { inviteId, role }
 *   DELETE (owner)  { inviteId } removes someone / cancels an invite
 *          (member) {} leaves the circle themselves
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireParentAccess(id, 'owner');
  if (!access.ok) return access.response;

  let body: { name?: unknown; email?: unknown; phone?: unknown; role?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const res = await createInvite({
    parentId: id,
    invitedBy: { id: access.user.id, name: access.user.name, email: access.user.email },
    name: String(body.name || ''),
    email: typeof body.email === 'string' ? body.email : null,
    phone: typeof body.phone === 'string' && body.phone.trim() ? body.phone : null,
    role: body.role === 'viewer' ? 'viewer' : 'co_manager'
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });

  return NextResponse.json({
    success: true,
    url: res.url,
    emailed: res.emailed,
    message: res.emailed
      ? `Invite emailed. You can also send them the link yourself.`
      : canEmailInvites()
        ? 'Invite created. Send them the link.'
        : 'Invite created. Send them the link on WhatsApp or anywhere you like (invite emails start once our email domain is set up).',
    caregivers: await getCaregiversForParent(id)
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireParentAccess(id, 'owner');
  if (!access.ok) return access.response;
  const { inviteId, role } = await req.json().catch(() => ({}));
  if (typeof inviteId !== 'string' || (role !== 'viewer' && role !== 'co_manager')) {
    return NextResponse.json({ error: 'inviteId and role are required' }, { status: 400 });
  }
  if (!(await setMemberRole(id, inviteId, role))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true, caregivers: await getCaregiversForParent(id) });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const inviteId = typeof body.inviteId === 'string' ? body.inviteId : null;

  if (!inviteId) {
    // A family member leaving on their own.
    const access = await requireParentAccess(id, 'view');
    if (!access.ok) return access.response;
    if (access.role === 'owner') {
      return NextResponse.json({ error: 'You set up this parent. To stop the calls, remove the parent instead.' }, { status: 400 });
    }
    await leaveParent(id, access.user.id);
    return NextResponse.json({ success: true, message: `You no longer get updates about ${access.parent.name}.` });
  }

  const access = await requireParentAccess(id, 'owner');
  if (!access.ok) return access.response;
  if (!(await revokeMember(id, inviteId))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true, caregivers: await getCaregiversForParent(id) });
}
