import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { DBSession } from './types';
import { prisma } from './prisma';

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
function isDevMasterOtp(code: string): boolean {
  return process.env.NODE_ENV === 'development' && code === '123456';
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

  const isMatch = isDevMasterOtp(enteredCode) || (await bcrypt.compare(enteredCode, record.codeHash));

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
function toDBSession(s: { token: string; userId: string; expiresAt: Date; createdAt: Date; rememberMe: boolean; revoked: boolean }): DBSession {
  return {
    token: s.token,
    userId: s.userId,
    expiresAt: s.expiresAt.toISOString(),
    createdAt: s.createdAt.toISOString(),
    rememberMe: s.rememberMe,
    revoked: s.revoked
  };
}

export async function createDBSession(userId: string, rememberMe = true): Promise<DBSession> {
  const token = 'sess_' + crypto.randomBytes(32).toString('hex');
  const expiryDays = rememberMe ? 30 : 1;
  const session = await prisma.dBSession.create({
    data: {
      token,
      userId,
      expiresAt: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000),
      rememberMe,
      revoked: false
    }
  });
  return toDBSession(session);
}

export async function getDBSession(token: string): Promise<DBSession | null> {
  const session = await prisma.dBSession.findUnique({ where: { token } });
  if (!session || session.revoked || session.expiresAt.getTime() < Date.now()) {
    return null;
  }
  return toDBSession(session);
}

export async function revokeDBSession(token: string): Promise<void> {
  await prisma.dBSession.updateMany({ where: { token }, data: { revoked: true } });
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await prisma.dBSession.updateMany({ where: { userId, revoked: false }, data: { revoked: true } });
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
      data: { token, userId, expiresAt: new Date(Date.now() + 20 * 60 * 1000), used: false }
    })
  ]);

  return token;
}

export async function verifyAndConsumePasswordResetToken(token: string): Promise<{ valid: boolean; userId?: string; error?: string }> {
  const record = await prisma.passwordResetRecord.findUnique({ where: { token } });

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
    where: { token, used: false },
    data: { used: true }
  });
  if (consumed.count !== 1) {
    return { valid: false, error: 'This password reset link was already used. Please request a new one.' };
  }

  await revokeAllUserSessions(record.userId);
  return { valid: true, userId: record.userId };
}
