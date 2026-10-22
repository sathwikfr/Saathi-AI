import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { User } from './types';
import { getDBSession } from './security';
import { getUserById } from './db';

export const AUTH_COOKIE_NAME = 'carecircle_session';

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function comparePassword(plain: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(plain, hashed);
}

export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(AUTH_COOKIE_NAME)?.value || null;
}

/**
 * Resolves the logged-in user from the database-backed session cookie.
 * Only opaque `sess_` tokens are accepted; they are revocable and checked
 * against the DBSession table on every request.
 */
export async function getSessionUser(): Promise<User | null> {
  try {
    const token = await getSessionToken();
    if (!token || !token.startsWith('sess_')) return null;

    const dbSession = await getDBSession(token);
    if (!dbSession) return null;
    return await getUserById(dbSession.userId);
  } catch (err) {
    unstable_rethrow(err); // Next's own signals (e.g. "this page reads cookies, render it per request") must pass through
    console.error('[auth] getSessionUser failed:', err);
    return null;
  }
}
