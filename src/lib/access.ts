import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getSessionUser } from './auth';
import { CROSS_SITE_ERROR, isCrossSiteRequest } from './security';
import { getParentById } from './db';
import { parentRoleFor, roleAllows, AccessNeed } from './familyAccess';
import { ParentAccessRole, ParentProfile, User } from './types';

type Denied = { ok: false; response: NextResponse };

/** True when the current request was sent by another website's page (see isCrossSiteRequest). */
async function crossSite(): Promise<boolean> {
  try {
    return isCrossSiteRequest(await headers());
  } catch {
    return false; // called outside a request (scripts/tests): nothing to check
  }
}

export async function requireUser(): Promise<{ ok: true; user: User } | Denied> {
  // Every signed-in API route comes through here, so this is the app-wide CSRF check.
  if (await crossSite()) {
    return { ok: false, response: NextResponse.json(CROSS_SITE_ERROR, { status: 403 }) };
  }
  const user = await getSessionUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 }) };
  }
  return { ok: true, user };
}

/**
 * Loads a parent profile and checks what the logged-in user may do with it:
 *   'view'   owner or any accepted family member
 *   'manage' owner or a co-manager (calls, medicines, pause, contacts)
 *   'owner'  the account that pays for the parent (billing, removal, family invites)
 * Every /api/parents/[id]/* route must go through this (or requireOwnedParent).
 */
export async function requireParentAccess(
  parentId: string,
  need: AccessNeed
): Promise<{ ok: true; user: User; parent: ParentProfile; role: ParentAccessRole } | Denied> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const [parent, role] = await Promise.all([getParentById(parentId), parentRoleFor(auth.user.id, parentId)]);
  // Same response for "missing" and "someone else's" so ids can't be probed.
  if (!parent || !role) {
    return { ok: false, response: NextResponse.json({ error: 'Parent profile not found.' }, { status: 404 }) };
  }
  if (!roleAllows(role, need)) {
    const msg = need === 'owner'
      ? 'Only the person who set up this parent can do that.'
      : 'You can view this parent, but only the family members who manage their calls can change things.';
    return { ok: false, response: NextResponse.json({ error: msg, code: 'FORBIDDEN_ROLE' }, { status: 403 }) };
  }
  return { ok: true, user: auth.user, parent: { ...parent, accessRole: role }, role };
}

/** Owner-only access (billing-related actions, removing the parent, managing the family circle). */
export async function requireOwnedParent(
  parentId: string
): Promise<{ ok: true; user: User; parent: ParentProfile } | Denied> {
  return requireParentAccess(parentId, 'owner');
}
