/**
 * Who may see or manage a parent (the "family circle"). Database only, no
 * Next.js imports, so the call pipeline and WhatsApp handlers can use it too.
 *
 *   owner       the account that added the parent and pays for it
 *   co_manager  an accepted family invite that may change things (calls, medicines, pause)
 *   viewer      an accepted family invite that may only look
 *
 * Owner-only: billing, removing the parent, inviting or removing family.
 */
import { prisma } from './prisma';
import { ParentAccessRole } from './types';

export type AccessNeed = 'view' | 'manage' | 'owner';

export async function parentRoleFor(userId: string, parentId: string): Promise<ParentAccessRole | null> {
  const parent = await prisma.parentProfile.findUnique({ where: { id: parentId }, select: { userId: true, isDeleted: true } });
  if (!parent || parent.isDeleted) return null;
  if (parent.userId === userId) return 'owner';
  const member = await prisma.caregiverInvite.findFirst({
    where: { parentId, userId, status: 'accepted' },
    select: { role: true }
  });
  if (!member) return null;
  return member.role === 'co_manager' ? 'co_manager' : 'viewer';
}

export function roleAllows(role: ParentAccessRole | null, need: AccessNeed): boolean {
  if (!role) return false;
  if (need === 'owner') return role === 'owner';
  if (need === 'manage') return role === 'owner' || role === 'co_manager';
  return true;
}

/** Everyone who should hear about a parent: the owner first, then accepted family members. */
export async function familyRecipients(parentId: string) {
  const parent = await prisma.parentProfile.findUnique({
    where: { id: parentId },
    include: {
      user: { include: { notificationPreferences: true } },
      caregivers: { where: { status: 'accepted', userId: { not: null } }, orderBy: [{ acceptedAt: 'asc' }, { invitedAt: 'asc' }] }
    }
  });
  if (!parent) return null;
  const memberIds = parent.caregivers.map(c => c.userId!).filter(id => id !== parent.userId);
  const found = memberIds.length
    ? await prisma.user.findMany({ where: { id: { in: memberIds } }, include: { notificationPreferences: true } })
    : [];
  // In the order they joined: the plan's WhatsApp allowance goes to the owner first, then the earliest members.
  const members = memberIds.map(id => found.find(u => u.id === id)).filter((u): u is (typeof found)[number] => !!u);
  return { parent, owner: parent.user, members };
}
