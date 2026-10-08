import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { DBSession } from './types';
import { prisma } from './prisma';
import { isLocalDevRequest } from './devMode';

// ---------------------------------------------------------------------------
// 1. RATE LIMITING
// Best-effort, per-process counters. On serverless each instance keeps its own
// window, so treat this as abuse dampening, not a hard security boundary.
// ---------------------------------------------------------------------------
declare global {
  // eslint-disable-next-line no-var
  var __carecircle_rate_limits: Map<string, { attempts: number; firstAttemptTime: number; blockedUntil?: number }> | undefined;
}

const rateLimits: Map<string, { attempts: number; firstAttemptTime: number; blockedUntil?: number }> =
  global.__carecircle_rate_limits || new Map();
if (!global.__carecircle_rate_limits) global.__carecircle_rate_limits = rateLimits;

export function checkRateLimit(key: string, maxAttempts = 5, windowMs = 15 * 60 * 1000): {
  allowed: boolean;
  remaining: number;
  retryAfterSec?: number;
} {
  const now = Date.now();
  const entry = rateLimits.get(key);

  if (!entry) {
    return { allowed: true, remaining: maxAttempts };
  }

  if (entry.blockedUntil && entry.blockedUntil > now) {
    const retryAfterSec = Math.ceil((entry.blockedUntil - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  if (now - entry.firstAttemptTime > windowMs) {
    rateLimits.delete(key);
    return { allowed: true, remaining: maxAttempts };
  }

  if (entry.attempts >= maxAttempts) {
    entry.blockedUntil = now + windowMs;
    rateLimits.set(key, entry);
    return { allowed: false, remaining: 0, retryAfterSec: Math.ceil(windowMs / 1000) };
  }

  return { allowed: true, remaining: maxAttempts - entry.attempts };
}

export function recordFailedAttempt(key: string, windowMs = 15 * 60 * 1000): void {
  const now = Date.now();
  const entry = rateLimits.get(key);

  if (!entry || now - entry.firstAttemptTime > windowMs) {
    rateLimits.set(key, { attempts: 1, firstAttemptTime: now });
  } else {
    entry.attempts += 1;
    rateLimits.set(key, entry);
  }
}

export function clearRateLimit(key: string): void {
  rateLimits.delete(key);
}

/**
 * The caller's IP for per-IP limits. On Vercel `x-real-ip` / the first `x-forwarded-for` entry are set by the
 * platform; elsewhere they may be spoofed, which only weakens this best-effort limit.
 */
export function clientIp(req: Request): string {
  return req.headers.get('x-real-ip')?.trim() || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
}

/**
 * CSRF guard: true when a browser says this request came from another site. Browsers attach `Origin` to every
 * cross-origin request except plain link navigations, so a mismatching Origin means another site's page sent it
 * (e.g. an auto-submitted `text/plain` form, which `req.json()` would still parse). Server-to-server callers
 * (webhooks, cron) send no Origin and are unaffected.
 */
export function isCrossSiteRequest(headers: Headers): boolean {
  const origin = headers.get('origin');
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return true; // "null" (sandboxed frames, data: URLs) or garbage
  }
  const allowed = new Set<string>();
  for (const h of [headers.get('x-forwarded-host'), headers.get('host')]) {
    if (h) allowed.add(h.split(',')[0].trim().toLowerCase());
  }
  try {
    if (process.env.NEXT_PUBLIC_APP_URL) allowed.add(new URL(process.env.NEXT_PUBLIC_APP_URL).host.toLowerCase());
  } catch {
    /* ignore a malformed env value */
  }
  return !allowed.has(originHost);
}

export const CROSS_SITE_ERROR = { error: 'This request came from another website and was blocked.', code: 'CROSS_SITE' };

/** Counts every use (not only failures): for actions that cost money or could be guessed at. */
export function consumeRateLimit(key: string, maxAttempts: number, windowMs: number): { allowed: boolean; retryAfterSec?: number } {
  const check = checkRateLimit(key, maxAttempts, windowMs);
  if (!check.allowed) return { allowed: false, retryAfterSec: check.retryAfterSec };
  recordFailedAttempt(key, windowMs);
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// 2. OTP CODES (stored hashed in the database only)
// ---------------------------------------------------------------------------
const OTP_MAX_ATTEMPTS = 5;

/**
 * The sandbox master code only works in local development. It is never
 * accepted in production or preview builds.
 */
async function isDevMasterOtp(code: string): Promise<boolean> {
  return code === '123456' && (await isLocalDevRequest());
}

export async function createAndStoreOtp(
  phone: string,
  purpose: 'login' | 'signup'
): Promise<{ code: string; expiresAt: string }> {
  const cleanPhone = phone.replace(/\D/g, '');
  const code = crypto.randomInt(100000, 1000000).toString();
  const codeHash = await bcrypt.hash(code, await bcrypt.genSalt(8));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  // Only the newest code for a phone + purpose is valid.
  await prisma.$transaction([
    prisma.oTPRecord.deleteMany({ where: { phone: cleanPhone, purpose } }),
    prisma.oTPRecord.create({ data: { phone: cleanPhone, codeHash, expiresAt, purpose } })
  ]);

  return { code, expiresAt: expiresAt.toISOString() };
}

export async function verifyAndConsumeOtp(
  phone: string,
  enteredCode: string,
  purpose: 'login' | 'signup'
): Promise<{ success: boolean; error?: string }> {
  const cleanPhone = phone.replace(/\D/g, '');

  const record = await prisma.oTPRecord.findFirst({
    where: { phone: cleanPhone, purpose },
    orderBy: { createdAt: 'desc' }
  });

  if (!record) {
    return { success: false, error: 'No OTP requested for this mobile number or code has expired. Please request a new OTP.' };
  }

  if (record.expiresAt.getTime() < Date.now()) {
    await prisma.oTPRecord.deleteMany({ where: { phone: cleanPhone, purpose } });
    return { success: false, error: 'This OTP has expired. Please request a new code.' };
  }

  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await prisma.oTPRecord.deleteMany({ where: { phone: cleanPhone, purpose } });
    return { success: false, error: 'Too many incorrect OTP attempts. Please request a new code.' };
  }

  const isMatch = (await isDevMasterOtp(enteredCode)) || (await bcrypt.compare(enteredCode, record.codeHash));

  if (!isMatch) {
    const updated = await prisma.oTPRecord.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } }
    });
    const remaining = Math.max(0, OTP_MAX_ATTEMPTS - updated.attempts);
    return { success: false, error: `Incorrect verification code. ${remaining} attempts remaining.` };
  }

  // Single use: consume every code for this phone + purpose.
  await prisma.oTPRecord.deleteMany({ where: { phone: cleanPhone, purpose } });
  return { success: true };
}

// ---------------------------------------------------------------------------
// 3. DATABASE SESSIONS (revocable, remember-me). The database is the only
// source of truth so a revoke on one server instance applies everywhere.
// ---------------------------------------------------------------------------
/**
 * Session and reset tokens are stored as SHA-256 hashes: someone who reads the
 * database (a leaked backup, a mis-granted role) gets nothing they can put in a
 * cookie. The raw token only ever lives in the browser cookie / the emailed link.
 * Rows written before hashing hold the raw token; they are upgraded on first use.
 */
export function hashToken(token: string): string {
  return 'h1_' + crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function toDBSession(
  s: { userId: string; expiresAt: Date; createdAt: Date; rememberMe: boolean; revoked: boolean },
  rawToken: string
): DBSession {
  return {
    token: rawToken,
    userId: s.userId,
    expiresAt: s.expiresAt.toISOString(),
    createdAt: s.createdAt.toISOString(),
    rememberMe: s.rememberMe,
    revoked: s.revoked
  };
}

/** Returns the raw token (for the cookie); only its hash is stored. */
export async function createDBSession(userId: string, rememberMe = true): Promise<DBSession> {
  const token = 'sess_' + crypto.randomBytes(32).toString('hex');
  const expiryDays = rememberMe ? 30 : 1;
  const session = await prisma.dBSession.create({
    data: {
      token: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000),
      rememberMe,
      revoked: false
    }
  });
  return toDBSession(session, token);
}

export async function getDBSession(token: string): Promise<DBSession | null> {
  const hashed = hashToken(token);
  let session = await prisma.dBSession.findUnique({ where: { token: hashed } });
  if (!session) {
    // Legacy row with the raw token: hash it in place so the user stays signed in.
    const legacy = await prisma.dBSession.findUnique({ where: { token } });
    if (legacy) {
      session = await prisma.dBSession.update({ where: { id: legacy.id }, data: { token: hashed } }).catch(() => legacy);
    }
  }
  if (!session || session.revoked || session.expiresAt.getTime() < Date.now()) {
    return null;
  }
  return toDBSession(session, token);
}

export async function revokeDBSession(token: string): Promise<void> {
  await prisma.dBSession.updateMany({ where: { token: { in: [hashToken(token), token] } }, data: { revoked: true } });
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await prisma.dBSession.updateMany({ where: { userId, revoked: false }, data: { revoked: true } });
}

/** After a password change: every other device is signed out, this one stays. */
export async function revokeOtherUserSessions(userId: string, keepToken: string | null): Promise<void> {
  await prisma.dBSession.updateMany({
    where: { userId, revoked: false, ...(keepToken ? { token: { notIn: [hashToken(keepToken), keepToken] } } : {}) },
    data: { revoked: true }
  });
}

// ---------------------------------------------------------------------------
// 4. PASSWORD RESET TOKENS (single use, 20 minute expiry)
// ---------------------------------------------------------------------------
export async function createPasswordResetToken(userId: string): Promise<string> {
  const token = 'rst_' + crypto.randomBytes(24).toString('hex');

  await prisma.$transaction([
    // Any earlier unused link stops working once a new one is issued.
    prisma.passwordResetRecord.updateMany({ where: { userId, used: false }, data: { used: true } }),
    prisma.passwordResetRecord.create({
      data: { token: hashToken(token), userId, expiresAt: new Date(Date.now() + 20 * 60 * 1000), used: false }
    })
  ]);

  return token;
}

export async function verifyAndConsumePasswordResetToken(token: string): Promise<{ valid: boolean; userId?: string; error?: string }> {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Password reset link is invalid or has already been used.' };
  }
  const stored = hashToken(token);
  const record = await prisma.passwordResetRecord.findUnique({ where: { token: stored } });

  if (!record) {
    return { valid: false, error: 'Password reset link is invalid or has already been used.' };
  }
  if (record.used) {
    return { valid: false, error: 'This password reset link was already used. Please request a new one.' };
  }
  if (record.expiresAt.getTime() < Date.now()) {
    return { valid: false, error: 'This password reset link has expired. Links are valid for 20 minutes.' };
  }

  // Atomic consume: only one concurrent request can flip used=false → true.
  const consumed = await prisma.passwordResetRecord.updateMany({
    where: { token: stored, used: false },
    data: { used: true }
  });
  if (consumed.count !== 1) {
    return { valid: false, error: 'This password reset link was already used. Please request a new one.' };
  }

  await revokeAllUserSessions(record.userId);
  return { valid: true, userId: record.userId };
}
