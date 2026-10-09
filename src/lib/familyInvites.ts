/**
 * Family circle invites: the owner invites a sibling, relative or carer to help
 * look after a parent. The invite is a link (copy / share on WhatsApp); it is
 * also emailed when Resend has a verified sending domain. Accepting needs an
 * Aaptha account (sign up or log in), then the parent appears on their dashboard
 * with their own updates. Members never need a plan; the owner's plan covers calls.
 */
import crypto from 'crypto';
import { prisma } from './prisma';
import { newId, newReminderStartCode } from './db';
import { normalizePhone } from './phone';
import { sendFamilyInviteEmail } from './email';

export type MemberRole = 'viewer' | 'co_manager';
export const MAX_FAMILY_MEMBERS = 8;
/** An unused invite link stops working after this: a link forwarded or leaked months later must not open a parent's health data. */
export const INVITE_VALID_DAYS = 14;

export function inviteExpired(invite: { invitedAt: Date }, now = new Date()): boolean {
  return now.getTime() - invite.invitedAt.getTime() > INVITE_VALID_DAYS * 86400000;
}

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export function inviteUrl(token: string) {
  return `${appUrl()}/invite/${token}`;
}

/** Emails only reach real people once a domain is verified in Resend (CLAUDE.md §4). */
export function canEmailInvites(env: NodeJS.ProcessEnv = process.env): boolean {
  const from = env.RESEND_FROM_EMAIL || '';
  return !!env.RESEND_API_KEY && !!from && !from.includes('@resend.dev');
}

/** Invite emails one person can send in 24 hours (each invite counts, removed ones too). */
const INVITE_EMAILS_PER_DAY = 10;

export async function createInvite(input: {
  parentId: string;
  invitedBy: { id: string; name: string; email: string; phone?: string };
  name: string;
  email?: string | null;
  phone?: string | null;
  role: MemberRole;
}): Promise<{ ok: true; inviteId: string; url: string; emailed: boolean } | { ok: false; error: string }> {
  const name = input.name.trim().slice(0, 120);
  const email = (input.email || '').trim().toLowerCase();
  if (!name) return { ok: false, error: 'Please enter their name.' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Please enter a valid email, or leave it empty and share the link.' };
  if (email && email === input.invitedBy.email.toLowerCase()) return { ok: false, error: 'You already look after this parent.' };
  let phone: string | null = null;
  if (input.phone) {
    const n = normalizePhone(input.phone);
    if (!n.ok) return { ok: false, error: n.reason };
    phone = n.e164;
  }

  const active = (await prisma.caregiverInvite.findMany({ where: { parentId: input.parentId, status: { in: ['pending', 'accepted'] } } }))
    .filter(a => a.status === 'accepted' || !inviteExpired(a));
  if (active.length >= MAX_FAMILY_MEMBERS) return { ok: false, error: `A parent can have up to ${MAX_FAMILY_MEMBERS} family members.` };
  if (email && active.some(a => a.email === email)) return { ok: false, error: `${email} is already invited.` };

  const token = crypto.randomBytes(24).toString('base64url');
  const invite = await prisma.caregiverInvite.create({
    data: {
      id: newId('cg'),
      parentId: input.parentId,
      email,
      name,
      phone,
      role: input.role,
      status: 'pending',
      token,
      invitedById: input.invitedBy.id
    }
  });

  let emailed = false;
  // Invite, remove, invite again would otherwise send our email to any address without limit: past a few a day the
  // link is still made (to share by hand), but no email goes out.
  const sentToday = email
    ? await prisma.caregiverInvite.count({ where: { invitedById: input.invitedBy.id, invitedAt: { gte: new Date(Date.now() - 86400000) } } })
    : 0;
  if (email && canEmailInvites() && sentToday <= INVITE_EMAILS_PER_DAY) {
    const parent = await prisma.parentProfile.findUnique({ where: { id: input.parentId }, select: { name: true } });
    const res = await sendFamilyInviteEmail({
      to: email,
      name,
      inviterName: input.invitedBy.name,
      parentName: parent?.name || 'your family member',
      role: input.role,
      inviteUrl: inviteUrl(token)
    }).catch(() => ({ success: false }));
    emailed = res.success;
  }
  return { ok: true, inviteId: invite.id, url: inviteUrl(token), emailed };
}

/** What the invite page shows before the person accepts (no private details). */
export async function getInvitePreview(token: string) {
  if (!token || token.length < 20) return null;
  const invite = await prisma.caregiverInvite.findUnique({
    where: { token },
    include: { parent: { select: { name: true, isDeleted: true, user: { select: { name: true } } } } }
  });
  if (!invite || invite.status !== 'pending' || invite.parent.isDeleted || inviteExpired(invite)) return null;
  return { name: invite.name, role: invite.role as MemberRole, parentName: invite.parent.name, inviterName: invite.parent.user.name };
}

export async function acceptInvite(
  token: string,
  user: { id: string }
): Promise<{ ok: true; parentId: string } | { ok: false; status: number; error: string }> {
  const invite = await prisma.caregiverInvite.findUnique({ where: { token }, include: { parent: true } });
  if (!invite || invite.status !== 'pending' || invite.parent.isDeleted) {
    return { ok: false, status: 404, error: 'This invite link has already been used or was cancelled. Ask for a new one.' };
  }
  if (inviteExpired(invite)) {
    return { ok: false, status: 410, error: `This invite link has expired (links work for ${INVITE_VALID_DAYS} days). Ask for a new one.` };
  }
  if (invite.parent.userId === user.id) {
    return { ok: false, status: 400, error: 'You already look after this parent.' };
  }
  const existing = await prisma.caregiverInvite.findFirst({ where: { parentId: invite.parentId, userId: user.id, status: 'accepted' } });
  if (existing) {
    await prisma.caregiverInvite.update({ where: { id: invite.id }, data: { status: 'revoked', token: null, revokedAt: new Date() } });
    return { ok: true, parentId: invite.parentId };
  }
  // Single use: the token is cleared in the same update that claims it.
  const claimed = await prisma.caregiverInvite.updateMany({
    where: { id: invite.id, status: 'pending', token },
    data: { status: 'accepted', userId: user.id, acceptedAt: new Date(), token: null }
  });
  if (claimed.count !== 1) return { ok: false, status: 409, error: 'This invite was just used. Ask for a new one.' };
  return { ok: true, parentId: invite.parentId };
}

/**
 * A co-manager could see the emergency-card link and the unused WhatsApp START links, so when one leaves or is
 * removed those are replaced: the old links stop working (the family re-shares the new card if they want).
 */
async function rotateManagerSecrets(parentId: string): Promise<void> {
  const p = await prisma.parentProfile.findUnique({ where: { id: parentId }, select: { cardToken: true, caretakerPhone: true } });
  if (!p) return;
  await prisma.parentProfile.update({
    where: { id: parentId },
    data: {
      reminderStartCode: newReminderStartCode(),
      ...(p.caretakerPhone ? { caretakerStartCode: newReminderStartCode() } : {}),
      ...(p.cardToken ? { cardToken: crypto.randomBytes(18).toString('base64url') } : {})
    }
  });
}

export async function revokeMember(parentId: string, inviteId: string): Promise<boolean> {
  const before = await prisma.caregiverInvite.findFirst({ where: { id: inviteId, parentId, status: { in: ['pending', 'accepted'] } }, select: { role: true, status: true } });
  const res = await prisma.caregiverInvite.updateMany({
    where: { id: inviteId, parentId, status: { in: ['pending', 'accepted'] } },
    data: { status: 'revoked', token: null, revokedAt: new Date() }
  });
  if (res.count === 1 && before?.status === 'accepted' && before.role === 'co_manager') await rotateManagerSecrets(parentId);
  return res.count === 1;
}

export async function setMemberRole(parentId: string, inviteId: string, role: MemberRole): Promise<boolean> {
  const before = await prisma.caregiverInvite.findFirst({ where: { id: inviteId, parentId, status: { in: ['pending', 'accepted'] } }, select: { role: true, status: true } });
  const res = await prisma.caregiverInvite.updateMany({ where: { id: inviteId, parentId, status: { in: ['pending', 'accepted'] } }, data: { role } });
  // A co-manager made view-only no longer manages: the links they could see are replaced, as when one is removed.
  if (res.count === 1 && before?.status === 'accepted' && before.role === 'co_manager' && role !== 'co_manager') await rotateManagerSecrets(parentId);
  return res.count === 1;
}

/** A member stops looking after a parent themselves. */
export async function leaveParent(parentId: string, userId: string): Promise<boolean> {
  const wasManager = !!(await prisma.caregiverInvite.findFirst({ where: { parentId, userId, status: 'accepted', role: 'co_manager' }, select: { id: true } }));
  const res = await prisma.caregiverInvite.updateMany({
    where: { parentId, userId, status: 'accepted' },
    data: { status: 'revoked', revokedAt: new Date() }
  });
  if (res.count > 0 && wasManager) await rotateManagerSecrets(parentId);
  return res.count > 0;
}
