/**
 * Aaptha data access layer.
 *
 * Prisma (Supabase Postgres) is the single source of truth. There are no
 * in-memory caches: on serverless each instance would hold a different copy,
 * and failed writes used to be hidden behind "successful" cached results.
 * Write helpers throw on failure so API routes can report real errors.
 */
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import {
  User,
  UserSubscription,
  Invoice,
  PlanId,
  ParentProfile,
  Medicine,
  EmergencyContact,
  CallLog,
  AlertRecord,
  ScheduleSuggestion,
  CaregiverInvite,
  NotificationPreferences,
  MedicineReport,
  ExtractedMedicineCandidate,
  ScheduledCallSlot,
  MedicineTimingSlot,
  FoodRelation,
  LinkedMedicineDetail,
  SubscriptionStatus
} from './types';
import { PLANS, FREE_TRIAL_DAYS, freeTrialEnd } from './plans';
import { prisma } from './prisma';
import { isAdminEmail } from './adminEmail';
import { toEscalationSummary } from './escalation';
import { normalizePhone } from './phone';
import {
  generateMedicineCheckinQuestion,
  inferSlotTimeFromFoodRelation,
  cleanMedicineNameForSpeech
} from './scheduleGenerator';

export interface DBUser extends User {
  passwordHash?: string;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  whatsapp: true,
  sms: true,
  email: true,
  push: false,
  minimumAlertLevel: 1
};

/** Collision-resistant, prefixed ids (e.g. `parent_3f9a1c0b7d2e`). */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

/** @deprecated The database is no longer seeded implicitly. Kept for old scripts. */
export function ensureDemoDataSeeded() {
  // no-op
}

// ---------------------------------------------------------------------------
// USERS
// ---------------------------------------------------------------------------
const userInclude = { subscription: true, notificationPreferences: true } as const;
type PrismaUserFull = Prisma.UserGetPayload<{ include: typeof userInclude }>;

function toSubscription(s: NonNullable<PrismaUserFull['subscription']>): UserSubscription {
  return {
    id: s.id,
    planId: (PLANS[s.planId as PlanId] ? s.planId : 'family') as PlanId,
    status: s.status as SubscriptionStatus,
    startDate: s.startDate.toISOString(),
    trialEndsAt: s.trialEndsAt ? s.trialEndsAt.toISOString() : undefined,
    currentPeriodEnd: s.currentPeriodEnd.toISOString(),
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    amount: s.amount,
    paymentMethodLast4: s.paymentMethodLast4 || undefined,
    paymentMethodBrand: s.paymentMethodBrand || undefined,
    razorpaySubscriptionId: s.razorpaySubscriptionId || undefined,
    razorpayPaymentId: s.razorpayPaymentId || undefined
  };
}

function toDBUser(p: PrismaUserFull): DBUser {
  const prefs = p.notificationPreferences;
  return {
    id: p.id,
    name: p.name,
    email: p.email,
    phone: p.phone || '',
    avatar: p.avatar || initialsOf(p.name),
    emailVerified: p.emailVerified,
    isAdmin: isAdminEmail(p.email),
    phoneVerified: p.phoneVerified,
    createdAt: p.createdAt.toISOString(),
    passwordHash: p.passwordHash || undefined,
    subscription: p.subscription ? toSubscription(p.subscription) : undefined,
    notificationPreferences: prefs ? toPrefs(prefs) : { ...DEFAULT_NOTIFICATION_PREFERENCES }
  };
}

function toPrefs(prefs: Prisma.NotificationPreferencesGetPayload<object>): NotificationPreferences {
  return {
    whatsapp: prefs.whatsapp,
    sms: prefs.sms,
    email: prefs.email,
    push: prefs.push,
    minimumAlertLevel: prefs.minimumAlertLevel,
    timezone: prefs.timezone,
    dailySummary: prefs.dailySummary,
    dailySummaryHour: prefs.dailySummaryHour,
    weeklyDigest: prefs.weeklyDigest,
    digestDay: prefs.digestDay,
    digestHour: prefs.digestHour,
    monthlySummary: prefs.monthlySummary,
    wakeForEmergency: prefs.wakeForEmergency,
    emergencyPhone: prefs.emergencyPhone
  };
}

function stripHash(u: DBUser): User {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, ...user } = u;
  return user;
}

function initialsOf(name: string): string {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .map(p => p[0])
      .join('')
      .toUpperCase()
      .substring(0, 2) || 'CC'
  );
}

export async function getUserByEmail(email: string): Promise<DBUser | null> {
  const normalized = email.toLowerCase().trim();
  if (!normalized) return null;
  const pUser = await prisma.user.findUnique({ where: { email: normalized }, include: userInclude });
  return pUser ? toDBUser(pUser) : null;
}

/**
 * All users whose stored phone normalises to the same E.164 number.
 * Legacy rows may be stored with spaces/dashes, so candidates are narrowed in
 * SQL by trailing digits and then compared exactly after normalisation.
 */
async function findUsersByPhone(phone: string): Promise<PrismaUserFull[]> {
  const normalized = normalizePhone(phone);
  if (!normalized.ok) return [];
  const digits = normalized.e164.replace(/\D/g, '');
  const tail = digits.slice(-10);

  const candidates = await prisma.$queryRaw<{ id: string; phone: string | null }[]>`
    SELECT id, phone FROM "User"
    WHERE phone IS NOT NULL
      AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE ${'%' + tail}
  `;

  const matchingIds = candidates
    .filter(c => {
      const n = c.phone ? normalizePhone(c.phone) : null;
      return n?.ok && n.e164 === normalized.e164;
    })
    .map(c => c.id);

  if (matchingIds.length === 0) return [];
  return prisma.user.findMany({ where: { id: { in: matchingIds } }, include: userInclude });
}

/** True if any account already uses this phone number. */
export async function isPhoneRegistered(phone: string): Promise<boolean> {
  return (await findUsersByPhone(phone)).length > 0;
}

/**
 * The single account registered with this phone. Returns null when none or
 * when several legacy accounts share the number (never guess who is logging in).
 */
export async function getUserByPhone(phone: string): Promise<DBUser | null> {
  const users = await findUsersByPhone(phone);
  if (users.length !== 1) {
    if (users.length > 1) {
      console.warn(`[db] ${users.length} accounts share one phone number; phone login refused for safety.`);
    }
    return null;
  }
  return toDBUser(users[0]);
}

export async function getUserByEmailOrPhone(identifier: string): Promise<DBUser | null> {
  if (!identifier) return null;
  const trimmed = identifier.trim();
  return trimmed.includes('@') ? getUserByEmail(trimmed) : getUserByPhone(trimmed);
}

export async function getUserById(id: string): Promise<User | null> {
  const pUser = await prisma.user.findUnique({ where: { id }, include: userInclude });
  return pUser ? stripHash(toDBUser(pUser)) : null;
}

export async function getUserPasswordHash(userId: string): Promise<string | null> {
  const pUser = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  return pUser?.passwordHash || null;
}

export async function createUser(userData: {
  name: string;
  email: string;
  phone?: string | null;
  passwordHash?: string;
  planId?: PlanId;
  emailVerified?: boolean;
  phoneVerified?: boolean;
}): Promise<User> {
  const now = new Date();
  const email = userData.email.toLowerCase().trim();

  const created = await prisma.user.create({
    data: {
      id: newId('usr'),
      name: userData.name,
      email,
      phone: userData.phone || null,
      avatar: initialsOf(userData.name),
      passwordHash: userData.passwordHash,
      emailVerified: userData.emailVerified ?? false,
      phoneVerified: userData.phoneVerified ?? false,
      // Every account starts on the 7-day free trial; a paid checkout replaces this row.
      subscription: {
        create: {
          id: newId('sub'),
          planId: 'free',
          status: 'free',
          startDate: now,
          currentPeriodEnd: new Date(now.getTime() + FREE_TRIAL_DAYS * 86400000),
          amount: 0
        }
      },
      notificationPreferences: { create: { ...DEFAULT_NOTIFICATION_PREFERENCES } }
    },
    include: userInclude
  });

  return stripHash(toDBUser(created));
}

export async function updateUserProfile(
  userId: string,
  updates: {
    name?: string;
    email?: string;
    phone?: string;
    avatar?: string;
    notificationPreferences?: Partial<NotificationPreferences>;
  }
): Promise<{ user: User; emailChanged: boolean } | null> {
  const current = await prisma.user.findUnique({ where: { id: userId } });
  if (!current) return null;

  const data: Prisma.UserUpdateInput = {};
  let emailChanged = false;

  if (updates.email) {
    const newEmail = updates.email.toLowerCase().trim();
    if (newEmail !== current.email) {
      const conflict = await prisma.user.findUnique({ where: { email: newEmail } });
      if (conflict && conflict.id !== userId) {
        throw new Error('An account with this email already exists.');
      }
      data.email = newEmail;
      data.emailVerified = false;
      emailChanged = true;
    }
  }

  if (updates.name && updates.name.trim()) {
    data.name = updates.name.trim();
    if (!updates.avatar && (!current.avatar || current.avatar.length <= 3)) {
      data.avatar = initialsOf(updates.name.trim());
    }
  }

  if (updates.phone !== undefined) {
    const phone = updates.phone.trim();
    if (phone && phone !== current.phone) {
      const others = (await findUsersByPhone(phone)).filter(u => u.id !== userId);
      if (others.length > 0) {
        throw new Error('Another account already uses this mobile number.');
      }
      data.phoneVerified = false;
    }
    data.phone = phone || null;
  }

  if (updates.avatar !== undefined) {
    data.avatar = updates.avatar.trim();
  }

  if (updates.notificationPreferences) {
    // WhatsApp on/off is opt-in with a timestamp (/api/account/whatsapp), never set from here.
    const prefs = cleanPrefs(updates.notificationPreferences);
    data.notificationPreferences = {
      upsert: { create: { ...prefs, whatsapp: false }, update: { ...prefs } }
    };
  }

  const updated = await prisma.user.update({ where: { id: userId }, data, include: userInclude });
  return { user: stripHash(toDBUser(updated)), emailChanged };
}

/** Only the settings a family member may change themselves (WhatsApp on/off is opt-in with a timestamp, never set here). */
function cleanPrefs(p: Partial<NotificationPreferences>) {
  const out: Record<string, unknown> = {};
  const hour = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23 ? v : undefined);
  if (typeof p.sms === 'boolean') out.sms = p.sms;
  if (typeof p.email === 'boolean') out.email = p.email;
  if (typeof p.push === 'boolean') out.push = p.push;
  if (typeof p.minimumAlertLevel === 'number' && [1, 2, 3, 4].includes(p.minimumAlertLevel)) out.minimumAlertLevel = p.minimumAlertLevel;
  if (p.timezone === null || (typeof p.timezone === 'string' && isValidTimeZone(p.timezone))) out.timezone = p.timezone || null;
  if (typeof p.dailySummary === 'boolean') out.dailySummary = p.dailySummary;
  if (hour(p.dailySummaryHour) !== undefined) out.dailySummaryHour = p.dailySummaryHour;
  if (typeof p.weeklyDigest === 'boolean') out.weeklyDigest = p.weeklyDigest;
  if (typeof p.digestDay === 'number' && Number.isInteger(p.digestDay) && p.digestDay >= 0 && p.digestDay <= 6) out.digestDay = p.digestDay;
  if (hour(p.digestHour) !== undefined) out.digestHour = p.digestHour;
  if (typeof p.monthlySummary === 'boolean') out.monthlySummary = p.monthlySummary;
  if (typeof p.wakeForEmergency === 'boolean') out.wakeForEmergency = p.wakeForEmergency;
  if (p.emergencyPhone === null || p.emergencyPhone === '') out.emergencyPhone = null;
  else if (typeof p.emergencyPhone === 'string') {
    const n = normalizePhone(p.emergencyPhone);
    if (!n.ok) throw new Error(`Emergency call number: ${n.reason}`);
    out.emergencyPhone = n.e164;
  }
  return out as Omit<Prisma.NotificationPreferencesCreateWithoutUserInput, 'whatsapp'>;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz.length <= 64;
  } catch {
    return false;
  }
}

export async function updateUserPasswordHash(userId: string, newHash: string): Promise<boolean> {
  try {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } });
    return true;
  } catch (err) {
    console.error('[db] updateUserPasswordHash failed:', err);
    return false;
  }
}

/**
 * Records a plan change. Paid plans must only reach this function after a
 * verified Razorpay payment (see /api/razorpay/verify) or a verified webhook.
 */
export async function updateUserSubscription(
  userId: string,
  details: {
    planId: PlanId;
    razorpaySubscriptionId?: string;
    razorpayPaymentId?: string;
    paymentMethodLast4?: string;
    paymentMethodBrand?: string;
    /** Receipt number to store on the invoice (so the email and the invoice list agree). */
    invoiceNumber?: string;
  }
): Promise<UserSubscription> {
  const plan = PLANS[details.planId];
  const now = new Date();
  const trialEnd = plan.hasTrial ? new Date(now.getTime() + plan.trialDays * 86400000) : null;
  let periodEnd: Date;
  if (plan.priceMonthly === 0) {
    // Downgrading to Free never restarts the trial: it always ends 7 days after the account was created.
    const account = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
    periodEnd = freeTrialEnd(account?.createdAt ?? now);
  } else {
    periodEnd = trialEnd || new Date(now.getTime() + 30 * 86400000);
  }
  const status: SubscriptionStatus = plan.priceMonthly === 0 ? 'free' : plan.hasTrial ? 'trialing' : 'active';

  const fields = {
    planId: details.planId,
    status,
    startDate: now,
    trialEndsAt: trialEnd,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false,
    amount: plan.priceMonthly,
    paymentMethodLast4: details.paymentMethodLast4 || null,
    paymentMethodBrand: details.paymentMethodBrand || null,
    razorpaySubscriptionId: details.razorpaySubscriptionId || null,
    razorpayPaymentId: details.razorpayPaymentId || null
  };

  const [sub] = await prisma.$transaction([
    prisma.userSubscription.upsert({
      where: { userId },
      create: { id: newId('sub'), userId, ...fields },
      update: fields
    }),
    ...(plan.priceMonthly > 0
      ? [
          prisma.invoice.create({
            data: {
              id: newId('inv'),
              userId,
              invoiceNumber: details.invoiceNumber || `CC-${now.getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
              date: now.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' }),
              amount: plan.hasTrial ? 0 : plan.priceMonthly,
              planName: `${plan.name} (${plan.hasTrial ? `${plan.trialDays}-Day Free Trial Auth` : 'Monthly'})`,
              status: 'paid',
              paymentMethod: details.paymentMethodLast4
                ? `${details.paymentMethodBrand || 'Card / UPI'} •••• ${details.paymentMethodLast4}`
                : details.paymentMethodBrand || 'Razorpay'
            }
          })
        ]
      : [])
  ]);

  return toSubscription(sub);
}

export async function cancelSubscription(userId: string, reason?: string | null): Promise<boolean> {
  const res = await prisma.userSubscription.updateMany({
    where: { userId },
    data: {
      cancelAtPeriodEnd: true,
      status: 'cancelled',
      cancelledAt: new Date(),
      // Why people leave (admin metric); free text, trimmed.
      cancelReason: reason ? String(reason).trim().slice(0, 500) || null : null
    }
  });
  return res.count > 0;
}

export async function reactivateSubscription(userId: string): Promise<boolean> {
  const sub = await prisma.userSubscription.findUnique({ where: { userId } });
  if (!sub) return false;
  // Reactivation is only possible while the paid period is still running.
  if (sub.currentPeriodEnd.getTime() < Date.now()) return false;
  const status = sub.trialEndsAt && sub.trialEndsAt.getTime() > Date.now() ? 'trialing' : 'active';
  await prisma.userSubscription.update({
    where: { userId },
    data: { cancelAtPeriodEnd: false, status }
  });
  return true;
}

export async function getUserInvoices(userId: string): Promise<Invoice[]> {
  const pInvoices = await prisma.invoice.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  return pInvoices.map(inv => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    date: inv.date,
    amount: inv.amount,
    planName: inv.planName,
    status: inv.status as Invoice['status'],
    downloadUrl: inv.downloadUrl || undefined,
    paymentMethod: inv.paymentMethod
  }));
}

export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const pref = await prisma.notificationPreferences.findUnique({ where: { userId } });
  if (!pref) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  return toPrefs(pref);
}

// ---------------------------------------------------------------------------
// PARENTS & CALL SCHEDULE
// ---------------------------------------------------------------------------
const VALID_SLOTS: ScheduledCallSlot['slot'][] = ['morning', 'afternoon', 'evening', 'bedtime', 'wellness', 'custom'];
const TIME_RE = /^(0?[1-9]|1[0-2]):[0-5]\d\s?(AM|PM)$/i;

type PrismaSlot = Prisma.ScheduledCallSlotGetPayload<object>;

function parseLinkedMedicines(json: string | null): LinkedMedicineDetail[] | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function toSlot(cs: PrismaSlot): ScheduledCallSlot {
  return {
    id: cs.id,
    time: cs.time,
    slot: cs.slot as ScheduledCallSlot['slot'],
    label: cs.label,
    linkedMedicineNames: cs.linkedMedicineNames || [],
    linkedMedicines: parseLinkedMedicines(cs.linkedMedicinesJson),
    isActive: cs.isActive
  };
}

type PrismaParentWithSchedule = Prisma.ParentProfileGetPayload<{ include: { callSchedule: true } }>;

function toParent(p: PrismaParentWithSchedule): ParentProfile {
  const consent = (p.parentConsent || 'pending') as ParentProfile['parentConsent'];
  return {
    id: p.id,
    userId: p.userId,
    name: p.name,
    relationship: p.relationship,
    phone: p.phone,
    language: p.language,
    timezone: p.timezone,
    callTime: p.callTime,
    callSchedule: [...p.callSchedule]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(toSlot),
    isPaused: p.isPaused,
    pauseReason: p.pauseReason || undefined,
    pauseUntil: p.pauseUntil ? p.pauseUntil.toISOString() : undefined,
    consentGiven: p.consentGiven,
    consentDate: p.consentDate.toISOString(),
    createdAt: p.createdAt.toISOString(),
    isDeleted: p.isDeleted,
    parentConsent: consent,
    parentConsentAt: p.parentConsentAt?.toISOString(),
    address: p.address || undefined,
    livesAlone: p.livesAlone,
    bloodGroup: p.bloodGroup || undefined,
    conditions: p.conditions || undefined,
    allergies: p.allergies || undefined,
    nearestHospital: p.nearestHospital || undefined,
    doctorName: p.doctorName || undefined,
    doctorPhone: p.doctorPhone || undefined,
    introducedAt: p.introducedAt?.toISOString(),
    numberSavedAt: p.numberSavedAt?.toISOString(),
    birthDate: p.birthDate || undefined,
    companionEnabled: p.companionEnabled,
    companionDay: p.companionDay ?? undefined,
    companionTime: p.companionTime || undefined,
    companionTopics: p.companionTopics || undefined
  };
}

export async function getParentsForUser(userId: string): Promise<ParentProfile[]> {
  const list = await prisma.parentProfile.findMany({
    where: { userId, isDeleted: false },
    include: { callSchedule: true },
    orderBy: { createdAt: 'asc' }
  });
  return list.map(toParent);
}

/** Parents other people added and shared with this user through an accepted family invite. */
export async function getSharedParentsForUser(userId: string): Promise<ParentProfile[]> {
  const invites = await prisma.caregiverInvite.findMany({
    where: { userId, status: 'accepted' },
    include: { parent: { include: { callSchedule: true, user: { select: { name: true } } } } }
  });
  return invites
    .filter(i => !i.parent.isDeleted && i.parent.userId !== userId)
    .map(i => ({
      ...toParent(i.parent),
      accessRole: (i.role === 'co_manager' ? 'co_manager' : 'viewer') as ParentProfile['accessRole'],
      ownerName: i.parent.user.name
    }));
}

export async function getParentById(id: string): Promise<ParentProfile | null> {
  const p = await prisma.parentProfile.findUnique({ where: { id }, include: { callSchedule: true } });
  if (!p || p.isDeleted) return null;
  return toParent(p);
}

function sanitizeSlot(slot: Partial<ScheduledCallSlot>, fallbackTime: string) {
  const slotType = VALID_SLOTS.includes(slot.slot as ScheduledCallSlot['slot']) ? slot.slot! : 'custom';
  const time = slot.time && TIME_RE.test(slot.time.trim()) ? slot.time.trim() : fallbackTime;
  return {
    // Ids are always generated server-side: client ids (e.g. "slot_wellness_1")
    // are not globally unique and used to break parent creation.
    id: newId(`slot_${slotType}`),
    time,
    slot: slotType,
    label: (slot.label || 'Daily Check-in Call').toString().slice(0, 200),
    linkedMedicineNames: Array.isArray(slot.linkedMedicineNames) ? slot.linkedMedicineNames.map(String) : [],
    linkedMedicinesJson: Array.isArray(slot.linkedMedicines) ? JSON.stringify(slot.linkedMedicines) : null,
    isActive: slot.isActive !== false
  };
}

export async function createParent(data: {
  userId: string;
  name: string;
  relationship: string;
  phone: string;
  language: string;
  timezone?: string;
  callTime?: string;
  callSchedule?: ScheduledCallSlot[];
  consentGiven: boolean;
  details?: ParentDetailsUpdate;
}): Promise<ParentProfile> {
  const now = new Date();
  const fallbackTime = data.callTime && TIME_RE.test(data.callTime) ? data.callTime : '09:30 AM';
  const slots = (data.callSchedule && data.callSchedule.length > 0
    ? data.callSchedule
    : [{ slot: 'wellness', time: fallbackTime, label: 'Daily Wellness Check-in', isActive: true } as ScheduledCallSlot]
  ).map(s => sanitizeSlot(s, fallbackTime));

  const firstActive = slots.find(s => s.isActive) || slots[0];

  const created = await prisma.parentProfile.create({
    data: {
      id: newId('parent'),
      userId: data.userId,
      name: data.name,
      relationship: data.relationship,
      phone: data.phone,
      language: data.language || 'Hindi & English',
      timezone: data.timezone || 'Asia/Kolkata (IST)',
      callTime: firstActive.time,
      consentGiven: data.consentGiven,
      consentDate: now,
      // Saathi asks the parent themselves on the first call.
      parentConsent: 'pending',
      ...(data.details ? (cleanParentDetails(data.details) as Prisma.ParentProfileCreateWithoutUserInput) : {}),
      callSchedule: { create: slots },
      alerts: {
        create: {
          id: newId('alt'),
          level: 0,
          title: 'Profile Created & Scheduled',
          message: `Parent profile for ${data.name} created with ${slots.filter(s => s.isActive).length} daily check-in call(s).`,
          channel: 'email',
          timestamp: now.toISOString(),
          status: 'sent'
        }
      }
    },
    include: { callSchedule: true }
  });

  return toParent(created);
}

/** Emergency card, trust set-up and companion fields (all optional, all family-written). */
export interface ParentDetailsUpdate {
  address?: string | null;
  livesAlone?: boolean;
  bloodGroup?: string | null;
  conditions?: string | null;
  allergies?: string | null;
  nearestHospital?: string | null;
  doctorName?: string | null;
  doctorPhone?: string | null;
  birthDate?: string | null;
  companionEnabled?: boolean;
  companionDay?: number | null;
  companionTime?: string | null;
  companionTopics?: string | null;
}

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/** Validates and trims the optional parent details; throws "Invalid …" errors the routes pass on. */
export function cleanParentDetails(d: ParentDetailsUpdate): Prisma.ParentProfileUpdateInput {
  const out: Prisma.ParentProfileUpdateInput = {};
  const text = (v: unknown, max: number) =>
    v === null || v === '' ? null : typeof v === 'string' ? v.trim().slice(0, max) || null : undefined;
  const address = text(d.address, 400);
  if (address !== undefined) out.address = address;
  const conditions = text(d.conditions, 400);
  if (conditions !== undefined) out.conditions = conditions;
  const allergies = text(d.allergies, 200);
  if (allergies !== undefined) out.allergies = allergies;
  const hospital = text(d.nearestHospital, 200);
  if (hospital !== undefined) out.nearestHospital = hospital;
  const doctor = text(d.doctorName, 120);
  if (doctor !== undefined) out.doctorName = doctor;
  const topics = text(d.companionTopics, 400);
  if (topics !== undefined) out.companionTopics = topics;
  if (typeof d.livesAlone === 'boolean') out.livesAlone = d.livesAlone;
  if (typeof d.companionEnabled === 'boolean') out.companionEnabled = d.companionEnabled;
  if (d.bloodGroup !== undefined) {
    const bg = (d.bloodGroup || '').toUpperCase().replace(/\s+/g, '');
    if (bg && !BLOOD_GROUPS.includes(bg)) throw new Error('Invalid blood group.');
    out.bloodGroup = bg || null;
  }
  if (d.doctorPhone !== undefined) {
    if (!d.doctorPhone) out.doctorPhone = null;
    else {
      const n = normalizePhone(d.doctorPhone);
      if (!n.ok) throw new Error(`Invalid doctor's number: ${n.reason}`);
      out.doctorPhone = n.e164;
    }
  }
  if (d.birthDate !== undefined) {
    if (!d.birthDate) out.birthDate = null;
    else if (/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d.birthDate)) out.birthDate = d.birthDate;
    else throw new Error('Invalid birthday (use MM-DD).');
  }
  if (d.companionDay !== undefined) {
    if (d.companionDay === null) out.companionDay = null;
    else if (Number.isInteger(d.companionDay) && d.companionDay >= 0 && d.companionDay <= 6) out.companionDay = d.companionDay;
    else throw new Error('Invalid companion day.');
  }
  if (d.companionTime !== undefined) {
    if (!d.companionTime) out.companionTime = null;
    else if (TIME_RE.test(d.companionTime.trim())) out.companionTime = d.companionTime.trim().toUpperCase();
    else throw new Error('Invalid companion time.');
  }
  return out;
}

export async function updateParentDetails(id: string, details: ParentDetailsUpdate): Promise<ParentProfile | null> {
  const existing = await prisma.parentProfile.findUnique({ where: { id } });
  if (!existing || existing.isDeleted) return null;
  const updated = await prisma.parentProfile.update({ where: { id }, data: cleanParentDetails(details), include: { callSchedule: true } });
  return toParent(updated);
}

/** Family ticks off a trust set-up step (introduced Saathi / saved the number). */
export async function markParentSetupStep(id: string, step: 'introduced' | 'number_saved', done: boolean): Promise<void> {
  await prisma.parentProfile.update({
    where: { id },
    data: step === 'introduced' ? { introducedAt: done ? new Date() : null } : { numberSavedAt: done ? new Date() : null }
  });
}

/** Turns the shareable emergency card link on (new token) or off. */
export async function setEmergencyCardShared(id: string, shared: boolean): Promise<string | null> {
  const token = shared ? crypto.randomBytes(18).toString('base64url') : null;
  await prisma.parentProfile.update({ where: { id }, data: { cardToken: token } });
  return token;
}

export interface ParentUpdates {
  name?: string;
  relationship?: string;
  phone?: string;
  language?: string;
  timezone?: string;
  callTime?: string;
  isPaused?: boolean;
  pauseReason?: string | null;
  pauseUntil?: string | null;
}

export async function updateParent(id: string, updates: ParentUpdates): Promise<ParentProfile | null> {
  const existing = await prisma.parentProfile.findUnique({ where: { id } });
  if (!existing || existing.isDeleted) return null;

  const data: Prisma.ParentProfileUpdateInput = {};
  if (typeof updates.name === 'string' && updates.name.trim()) data.name = updates.name.trim();
  if (typeof updates.relationship === 'string' && updates.relationship.trim()) data.relationship = updates.relationship.trim();
  if (typeof updates.phone === 'string' && updates.phone.trim()) data.phone = updates.phone.trim();
  if (typeof updates.language === 'string' && updates.language.trim()) data.language = updates.language.trim();
  if (typeof updates.timezone === 'string' && updates.timezone.trim()) data.timezone = updates.timezone.trim();
  if (typeof updates.callTime === 'string' && TIME_RE.test(updates.callTime.trim())) data.callTime = updates.callTime.trim();

  if (typeof updates.isPaused === 'boolean') {
    data.isPaused = updates.isPaused;
    if (!updates.isPaused) {
      data.pauseReason = null;
      data.pauseUntil = null;
      // The parent said no or "stop calling me": resuming means Saathi asks them again first.
      if (existing.parentConsent === 'declined' || existing.parentConsent === 'withdrawn') data.parentConsent = 'pending';
    }
  }
  if (updates.pauseReason !== undefined && updates.isPaused !== false) {
    data.pauseReason = updates.pauseReason ? String(updates.pauseReason).slice(0, 200) : null;
  }
  if (updates.pauseUntil !== undefined && updates.isPaused !== false) {
    if (updates.pauseUntil === null) {
      data.pauseUntil = null;
    } else {
      const d = new Date(updates.pauseUntil);
      if (Number.isNaN(d.getTime())) {
        throw new Error('Invalid pause end date.');
      }
      data.pauseUntil = d;
    }
  }

  const updated = await prisma.parentProfile.update({ where: { id }, data, include: { callSchedule: true } });
  return toParent(updated);
}

export async function pauseParentCalls(
  id: string,
  isPaused: boolean,
  pauseReason?: string,
  pauseUntil?: string
): Promise<ParentProfile | null> {
  return updateParent(id, {
    isPaused,
    pauseReason: isPaused ? pauseReason || null : null,
    pauseUntil: isPaused ? pauseUntil || null : null
  });
}

export async function deleteParentSoft(id: string): Promise<boolean> {
  const res = await prisma.parentProfile.updateMany({ where: { id }, data: { isDeleted: true } });
  return res.count > 0;
}

// ---------------------------------------------------------------------------
// MEDICINES
// ---------------------------------------------------------------------------
function toMedicine(m: Prisma.MedicineGetPayload<object>): Medicine {
  return {
    id: m.id,
    parentId: m.parentId,
    name: m.name,
    dosage: m.dosage,
    timeOfDay: m.timeOfDay as Medicine['timeOfDay'],
    timingSlots: m.timingSlots as MedicineTimingSlot[],
    foodRelation: m.foodRelation as FoodRelation,
    frequency: m.frequency as Medicine['frequency'],
    isActive: m.isActive,
    purpose: m.purpose || undefined
  };
}

/** All medicines for a parent, including paused ones (the dashboard can re-enable them). */
export async function getMedicinesForParent(parentId: string): Promise<Medicine[]> {
  const meds = await prisma.medicine.findMany({ where: { parentId }, orderBy: { createdAt: 'asc' } });
  return meds.map(toMedicine);
}

function medicineWriteData(med: Omit<Medicine, 'id' | 'parentId'>) {
  return {
    name: med.name,
    dosage: med.dosage,
    timeOfDay: med.timeOfDay,
    timingSlots: med.timingSlots && med.timingSlots.length > 0 ? med.timingSlots : [med.timeOfDay || 'morning'],
    foodRelation: med.foodRelation || 'not_specified',
    frequency: med.frequency || 'daily',
    isActive: med.isActive,
    purpose: med.purpose?.trim() ? med.purpose.trim().slice(0, 160) : null
  };
}

export async function setMedicinesForParent(parentId: string, meds: Medicine[]): Promise<Medicine[]> {
  const saved = await prisma.$transaction(
    meds.map(med =>
      prisma.medicine.upsert({
        where: { id: med.id },
        create: { id: med.id, parentId, ...medicineWriteData(med) },
        update: medicineWriteData(med)
      })
    )
  );
  return saved.map(toMedicine);
}

export async function addMedicine(parentId: string, medData: Omit<Medicine, 'id' | 'parentId'>): Promise<Medicine> {
  const created = await prisma.medicine.create({
    data: { id: newId('med'), parentId, ...medicineWriteData(medData) }
  });
  return toMedicine(created);
}

/** The family's own words for why a medicine matters (Saathi repeats them; it never invents a reason). */
export async function setMedicinePurpose(parentId: string, medicineId: string, purpose: string | null): Promise<Medicine | null> {
  const med = await prisma.medicine.findFirst({ where: { id: medicineId, parentId } });
  if (!med) return null;
  const updated = await prisma.medicine.update({
    where: { id: medicineId },
    data: { purpose: purpose?.trim() ? purpose.trim().slice(0, 160) : null }
  });
  return toMedicine(updated);
}

/** Medicines the family marks as stopped after a new prescription (kept, just inactive). */
export async function deactivateMedicines(parentId: string, medicineIds: string[]): Promise<number> {
  if (medicineIds.length === 0) return 0;
  const res = await prisma.medicine.updateMany({ where: { parentId, id: { in: medicineIds } }, data: { isActive: false } });
  return res.count;
}

export async function toggleMedicineStatus(parentId: string, medicineId: string): Promise<Medicine | null> {
  const med = await prisma.medicine.findFirst({ where: { id: medicineId, parentId } });
  if (!med) return null;
  const updated = await prisma.medicine.update({ where: { id: medicineId }, data: { isActive: !med.isActive } });
  return toMedicine(updated);
}

const MEAL_SLOTS = ['morning', 'afternoon', 'evening', 'bedtime'] as const;
type MealSlot = (typeof MEAL_SLOTS)[number];

const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  morning: 'Morning Medicine Reminder',
  afternoon: 'Afternoon Medicine Check',
  evening: 'Evening Medicine Reminder',
  bedtime: 'Night Medicine & Sleep Check'
};

/**
 * Makes sure Saathi will ask about newly added medicines: each medicine is
 * linked (with its question script) to the parent's active call slot for each
 * of its timing slots. A missing meal slot is created with an inferred time.
 * Returns human-readable notes about any new call slots created.
 */
export async function linkMedicinesIntoSchedule(parentId: string, meds: Medicine[]): Promise<string[]> {
  const notes: string[] = [];
  const slots = await prisma.scheduledCallSlot.findMany({ where: { parentId, isActive: true }, orderBy: { createdAt: 'asc' } });

  for (const med of meds) {
    const medSlots: MedicineTimingSlot[] =
      med.timingSlots && med.timingSlots.length > 0 ? med.timingSlots : [med.timeOfDay || 'morning'];

    for (const medSlot of medSlots) {
      const isMeal = (MEAL_SLOTS as readonly string[]).includes(medSlot);
      const questionSlot = isMeal ? medSlot : 'as_needed';
      const detail: LinkedMedicineDetail = {
        name: med.name,
        dosage: med.dosage,
        foodRelation: med.foodRelation || 'not_specified',
        questionScript: generateMedicineCheckinQuestion(med.name, med.foodRelation || 'not_specified', questionSlot)
      };

      // As-needed / unspecified medicines ride along on the first active call.
      let target = isMeal ? slots.find(s => s.slot === medSlot) : slots[0];

      if (!target) {
        if (!isMeal) continue;
        const mealSlot = medSlot as MealSlot;
        const time = inferSlotTimeFromFoodRelation(mealSlot, [med.foodRelation || 'not_specified']);
        target = await prisma.scheduledCallSlot.create({
          data: {
            id: newId(`slot_${mealSlot}`),
            parentId,
            time,
            slot: mealSlot,
            label: `${MEAL_SLOT_LABELS[mealSlot]} — ${cleanMedicineNameForSpeech(med.name)}`,
            linkedMedicineNames: [],
            linkedMedicinesJson: JSON.stringify([]),
            isActive: true
          }
        });
        slots.push(target);
        notes.push(`Added a new ${mealSlot} check-in call at ${time} for ${med.name}.`);
      }

      const names = target.linkedMedicineNames || [];
      if (names.includes(med.name)) continue;

      const linked = parseLinkedMedicines(target.linkedMedicinesJson) || [];
      const updated = await prisma.scheduledCallSlot.update({
        where: { id: target.id },
        data: {
          linkedMedicineNames: [...names, med.name],
          linkedMedicinesJson: JSON.stringify([...linked, detail])
        }
      });
      Object.assign(target, updated);
    }
  }

  return notes;
}

// ---------------------------------------------------------------------------
// EMERGENCY CONTACTS
// ---------------------------------------------------------------------------
export async function getEmergencyContacts(parentId: string): Promise<EmergencyContact[]> {
  const list = await prisma.emergencyContact.findMany({ where: { parentId }, orderBy: { createdAt: 'asc' } });
  return list.map(c => ({
    id: c.id,
    parentId,
    name: c.name,
    relation: c.relation,
    phone: c.phone,
    priority: c.priority as EmergencyContact['priority'],
    role: (c.role || undefined) as EmergencyContact['role'],
    isLocal: c.isLocal,
    practiceAt: c.practiceAt?.toISOString(),
    practiceResult: c.practiceResult || undefined
  }));
}

const CONTACT_ROLES = ['family', 'neighbour', 'security', 'doctor', 'caregiver', 'other'];

/**
 * Replaces a parent's emergency contacts with the family's edited list (validated by the route).
 * Contacts no longer on the list are removed; practice results of kept contacts stay.
 */
export async function replaceEmergencyContacts(
  parentId: string,
  list: Array<{ id?: string; name: string; relation: string; phone: string; role?: string; isLocal?: boolean }>
): Promise<EmergencyContact[]> {
  const existing = await prisma.emergencyContact.findMany({ where: { parentId } });
  const keepIds = new Set(list.map(c => c.id).filter((id): id is string => !!id && existing.some(e => e.id === id)));
  await prisma.$transaction([
    prisma.emergencyContact.deleteMany({ where: { parentId, id: { notIn: [...keepIds] } } }),
    ...list.map((c, i) => {
      const data = {
        name: c.name,
        relation: c.relation,
        phone: c.phone,
        priority: i === 0 ? 'primary' : 'secondary',
        role: c.role && CONTACT_ROLES.includes(c.role) ? c.role : null,
        isLocal: !!c.isLocal
      };
      return c.id && keepIds.has(c.id)
        ? prisma.emergencyContact.update({ where: { id: c.id }, data })
        : prisma.emergencyContact.create({ data: { id: newId('emg'), parentId, ...data } });
    })
  ]);
  return getEmergencyContacts(parentId);
}

export async function setEmergencyContacts(parentId: string, list: EmergencyContact[]): Promise<EmergencyContact[]> {
  await prisma.$transaction(
    list.map(c =>
      prisma.emergencyContact.upsert({
        where: { id: c.id },
        create: {
          id: c.id, parentId, name: c.name, relation: c.relation, phone: c.phone, priority: c.priority,
          role: c.role || null, isLocal: !!c.isLocal
        },
        update: { name: c.name, relation: c.relation, phone: c.phone, priority: c.priority, role: c.role || null, isLocal: !!c.isLocal }
      })
    )
  );
  return list;
}

// ---------------------------------------------------------------------------
// CALL LOGS
// ---------------------------------------------------------------------------
export async function getCallLogsForParent(parentId: string): Promise<CallLog[]> {
  const list = await prisma.callLog.findMany({ where: { parentId }, orderBy: { createdAt: 'desc' } });
  return list.map(cl => ({
    id: cl.id,
    parentId,
    scheduledTime: cl.scheduledTime,
    actualAnswerTime: cl.actualAnswerTime || undefined,
    status: cl.status as CallLog['status'],
    durationSeconds: cl.durationSeconds,
    medicationConfirmed: cl.medicationConfirmed,
    mood: cl.mood as CallLog['mood'],
    summary: cl.summary,
    notes: cl.notes || undefined,
    createdAt: cl.createdAt.toISOString(),
    slot: cl.slot || undefined,
    slotId: cl.slotId || undefined,
    attemptNumber: cl.attemptNumber,
    failureReason: cl.failureReason || undefined,
    details: cl.status === 'answered' ? callDetails(cl.resultJson) : undefined
  }));
}

/** The structured end-of-call result kept on the CallLog (no transcript). */
export function callDetails(resultJson: string | null): CallLog['details'] {
  if (!resultJson) return undefined;
  try {
    const r = JSON.parse(resultJson);
    return {
      medicineResults: Array.isArray(r.medicineResults) ? r.medicineResults : [],
      healthConcern: r.healthConcern ?? null,
      emergencyFlag: !!r.emergencyFlag,
      sleep: r.sleep ?? null,
      appetite: r.appetite ?? null,
      pain: r.pain ?? null,
      painWhere: r.painWhere ?? null,
      runningLow: Array.isArray(r.runningLow) ? r.runningLow : [],
      stoppedReason: r.stoppedReason ?? null,
      consent: r.consent ?? null,
      callType: r.callType
    };
  } catch {
    return undefined;
  }
}

export async function addCallLog(parentId: string, log: Omit<CallLog, 'id' | 'parentId'>): Promise<CallLog> {
  const created = await prisma.callLog.create({
    data: {
      id: newId('call'),
      parentId,
      scheduledTime: log.scheduledTime,
      actualAnswerTime: log.actualAnswerTime,
      status: log.status,
      durationSeconds: log.durationSeconds,
      medicationConfirmed: log.medicationConfirmed,
      mood: log.mood,
      summary: log.summary,
      notes: log.notes
    }
  });
  return { ...log, id: created.id, parentId, createdAt: created.createdAt.toISOString() };
}

// ---------------------------------------------------------------------------
// SCHEDULE SUGGESTIONS
// ---------------------------------------------------------------------------
export async function getScheduleSuggestionsForParent(parentId: string): Promise<ScheduleSuggestion[]> {
  const list = await prisma.scheduleSuggestion.findMany({ where: { parentId }, orderBy: { createdAt: 'desc' } });
  return list.map(sg => ({
    id: sg.id,
    parentId,
    currentCallTime: sg.currentCallTime,
    suggestedTime: sg.suggestedTime,
    confidencePct: sg.confidencePct,
    sampleSize: sg.sampleSize,
    reason: sg.reason,
    status: sg.status as ScheduleSuggestion['status'],
    createdAt: sg.createdAt.toISOString()
  }));
}

/**
 * Accepting a suggestion moves the matching call slot(s) to the suggested
 * time. Suggestions never change the schedule without this explicit accept.
 */
export async function updateScheduleSuggestionStatus(
  parentId: string,
  suggestionId: string,
  status: 'accepted' | 'dismissed'
): Promise<{ success: boolean; updatedCallTime?: string }> {
  const item = await prisma.scheduleSuggestion.findFirst({ where: { id: suggestionId, parentId } });
  if (!item || item.status !== 'pending') return { success: false };

  if (status === 'dismissed') {
    await prisma.scheduleSuggestion.update({ where: { id: suggestionId }, data: { status } });
    return { success: true };
  }

  await prisma.$transaction([
    prisma.scheduleSuggestion.update({ where: { id: suggestionId }, data: { status } }),
    prisma.scheduledCallSlot.updateMany({
      where: { parentId, time: item.currentCallTime, isActive: true },
      data: { time: item.suggestedTime }
    }),
    prisma.parentProfile.updateMany({
      where: { id: parentId, callTime: item.currentCallTime },
      data: { callTime: item.suggestedTime }
    })
  ]);
  return { success: true, updatedCallTime: item.suggestedTime };
}

// ---------------------------------------------------------------------------
// ALERTS
// ---------------------------------------------------------------------------
export async function getAlertsForParent(parentId: string): Promise<AlertRecord[]> {
  const [list, escalations] = await Promise.all([
    prisma.alertRecord.findMany({ where: { parentId }, orderBy: { createdAt: 'desc' } }),
    prisma.escalation.findMany({ where: { parentId, alertId: { not: null } }, include: { attempts: true } })
  ]);
  const byAlert = new Map(escalations.map(e => [e.alertId!, e]));
  return list.map(al => ({
    id: al.id,
    parentId,
    level: Math.max(0, Math.min(4, al.level)) as AlertRecord['level'],
    title: al.title,
    message: al.message,
    channel: al.channel as AlertRecord['channel'],
    timestamp: al.timestamp,
    status: al.status as AlertRecord['status'],
    createdAt: al.createdAt.toISOString(),
    acknowledgedAt: al.acknowledgedAt ? al.acknowledgedAt.toISOString() : undefined,
    handledByName: al.handledByName || undefined,
    handledVia: al.handledVia || undefined,
    outcome: (al.outcome || undefined) as AlertRecord['outcome'],
    outcomeNote: al.outcomeNote || undefined,
    outcomeAt: al.outcomeAt?.toISOString(),
    escalation: byAlert.has(al.id) ? toEscalationSummary(byAlert.get(al.id)!) : undefined
  }));
}

// ---------------------------------------------------------------------------
// CAREGIVERS
// ---------------------------------------------------------------------------
export async function getCaregiversForParent(parentId: string): Promise<CaregiverInvite[]> {
  const list = await prisma.caregiverInvite.findMany({ where: { parentId, status: { not: 'revoked' } }, orderBy: { invitedAt: 'asc' } });
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  return list.map(cg => ({
    id: cg.id,
    parentId,
    email: cg.email,
    name: cg.name,
    role: cg.role as CaregiverInvite['role'],
    status: cg.status as CaregiverInvite['status'],
    invitedAt: cg.invitedAt.toISOString(),
    phone: cg.phone || undefined,
    acceptedAt: cg.acceptedAt?.toISOString(),
    inviteUrl: cg.status === 'pending' && cg.token ? `${base}/invite/${cg.token}` : undefined
  }));
}

// ---------------------------------------------------------------------------
// MEDICINE REPORTS (prescription extraction audit trail, persisted)
// ---------------------------------------------------------------------------
function toMedicineReport(r: Prisma.MedicineReportGetPayload<object>): MedicineReport {
  let extracted: ExtractedMedicineCandidate[] = [];
  try {
    const parsed = JSON.parse(r.rawExtractionJson);
    if (Array.isArray(parsed)) extracted = parsed;
  } catch {
    extracted = [];
  }
  return {
    id: r.id,
    parentId: r.parentId || undefined,
    userId: r.userId || undefined,
    fileName: r.fileName,
    fileType: r.fileType,
    fileUrl: r.fileUrl || undefined,
    uploadedAt: r.uploadedAt.toISOString(),
    rawExtractionJson: extracted,
    batchConfidence: (r.batchConfidence as MedicineReport['batchConfidence']) || undefined,
    batchQualityWarning: r.batchQualityWarning || undefined,
    confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : undefined,
    confirmedMedicineIds: r.confirmedMedicineIds,
    status: r.status as MedicineReport['status']
  };
}

export async function createMedicineReport(reportData: {
  parentId?: string;
  userId: string;
  fileName: string;
  fileType: string;
  rawExtractionJson: ExtractedMedicineCandidate[];
  batchConfidence?: 'high' | 'medium' | 'low';
  batchQualityWarning?: string;
}): Promise<MedicineReport> {
  const created = await prisma.medicineReport.create({
    data: {
      id: newId('mrep'),
      parentId: reportData.parentId || null,
      userId: reportData.userId,
      fileName: reportData.fileName.slice(0, 255),
      fileType: reportData.fileType.slice(0, 100),
      // Uploaded files are not stored; only the extraction result is kept.
      fileUrl: null,
      rawExtractionJson: JSON.stringify(reportData.rawExtractionJson || []),
      batchConfidence: reportData.batchConfidence || null,
      batchQualityWarning: reportData.batchQualityWarning || null,
      status: 'draft'
    }
  });
  return toMedicineReport(created);
}

export async function getMedicineReportById(reportId: string): Promise<MedicineReport | null> {
  const r = await prisma.medicineReport.findUnique({ where: { id: reportId } });
  return r ? toMedicineReport(r) : null;
}

export async function getMedicineReportsForParent(parentId: string): Promise<MedicineReport[]> {
  const list = await prisma.medicineReport.findMany({ where: { parentId }, orderBy: { uploadedAt: 'desc' } });
  return list.map(toMedicineReport);
}

export async function confirmMedicineReport(
  reportId: string,
  confirmedMedicineIds: string[],
  owner: { userId: string; parentId: string }
): Promise<MedicineReport | null> {
  const r = await prisma.medicineReport.findUnique({ where: { id: reportId } });
  if (!r || r.userId !== owner.userId || (r.parentId && r.parentId !== owner.parentId)) return null;
  const updated = await prisma.medicineReport.update({
    where: { id: reportId },
    data: {
      status: 'confirmed',
      confirmedAt: new Date(),
      confirmedMedicineIds,
      parentId: owner.parentId
    }
  });
  return toMedicineReport(updated);
}
