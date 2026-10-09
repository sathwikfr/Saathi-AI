/**
 * Tells the family about a call. Call-related news goes to WhatsApp, one
 * message per call per person; email is only for account and billing.
 *
 * "The family" is the account owner plus everyone who accepted a family invite
 * (lib/familyAccess.ts). Each person's own settings apply: their WhatsApp opt-in,
 * their minimum alert level, and "daily summary" mode (routine results wait for
 * the summary; anything that needs attention is still sent at once).
 *
 *  - WhatsApp configured + person opted in: one WhatsApp message (familyMessages.ts
 *    picks it). If a level 3-4 message can't be delivered (now, or later via the
 *    status webhook), that person gets an email instead: the one safety exception.
 *  - WhatsApp configured but the person hasn't opted in: level 3-4 alerts are emailed.
 *  - WhatsApp NOT configured (until Meta is set up): alert emails exactly as before,
 *    so families never go from getting something to getting nothing.
 */
import { Prisma } from '@prisma/client';
import { ownerPlanFor } from './planAccess';
import { prisma } from './prisma';
import { newId } from './db';
import { normalizePhone } from './phone';
import { sendUrgentAlertEmail, sendCareSummaryEmail } from './email';
import { WhatsAppConfig, getWhatsAppConfig, sendTemplate, WHATSAPP_TEMPLATES, cleanParam, renderTemplate } from './whatsapp';
import { NotifyAlert, planFamilyMessage } from './familyMessages';
import { familyRecipients } from './familyAccess';
import { sendOnce } from './emailLog';

export interface NotifyDeps {
  sendEmail?: typeof sendUrgentAlertEmail;
  /** undefined = read the environment; null = WhatsApp off (tests). */
  whatsapp?: WhatsAppConfig | null;
  fetchImpl?: typeof fetch;
}

export type WhatsAppOutcome = 'sent' | 'failed' | 'duplicate' | 'not_wanted' | 'not_opted_in' | 'not_configured';

export interface NotifyResult {
  /** The account owner's outcome (members' outcomes are in `people`). */
  whatsapp: WhatsAppOutcome;
  emailed: number;
  people?: { userId: string; whatsapp: WhatsAppOutcome }[];
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

type Person = Prisma.UserGetPayload<{ include: { notificationPreferences: true } }>;

/** A person's WhatsApp number, or null when they haven't opted in. */
export function whatsappRecipient(user: Person): string | null {
  const prefs = user.notificationPreferences;
  if (!prefs?.whatsappOptInAt || prefs.whatsapp === false) return null;
  // Nothing goes to a number until that number itself has sent us START: an account could otherwise be pointed at a stranger.
  if (!prefs.whatsappVerifiedAt) return null;
  const phone = normalizePhone(prefs.whatsappNumber || user.phone || '');
  return phone.ok ? phone.e164 : null;
}

async function emailAlertsTo(person: Person, parentName: string, alerts: NotifyAlert[], deps: NotifyDeps): Promise<number> {
  const sendEmail = deps.sendEmail || sendUrgentAlertEmail;
  let emailed = 0;
  for (const alert of alerts) {
    try {
      const res = await sendEmail({
        to: person.email,
        name: person.name,
        parentName,
        alertLevel: alert.level >= 3 ? 'level_3' : 'level_2',
        alertType: alert.title,
        summary: alert.message,
        actionUrl: `${appUrl()}/dashboard`
      });
      if (res.success) {
        emailed += 1;
        await prisma.alertRecord.updateMany({ where: { id: alert.id, channel: 'dashboard' }, data: { channel: 'email' } });
      } else console.error(`[notify] Email to ${person.id} failed: ${res.error}`);
    } catch (err) {
      console.error(`[notify] Email to ${person.id} threw:`, err);
    }
  }
  return emailed;
}

/** Level 3-4 alerts, emailed to one person when WhatsApp can't carry them. */
async function emailSafetyFallback(person: Person, parentName: string, alerts: NotifyAlert[], deps: NotifyDeps): Promise<number> {
  if (person.notificationPreferences && person.notificationPreferences.email === false) return 0;
  const serious = alerts.filter(a => a.level >= 3);
  return serious.length ? emailAlertsTo(person, parentName, serious, deps) : 0;
}

/**
 * Who may get routine WhatsApp updates about a parent: the first `allowance` people (owner first, then family members
 * in the order they joined) among those who opted in. The plan sets the allowance (Solo 1, Family 2, Extended 5).
 */
export function whatsappAllowed(people: Person[], allowance: number): Set<string> {
  const allowed = new Set<string>();
  for (const p of people) {
    if (allowed.size >= allowance) break;
    if (whatsappRecipient(p)) allowed.add(p.id);
  }
  return allowed;
}

async function notifyPerson(
  person: Person,
  parent: { id: string; name: string; phone: string; userId: string },
  input: { callLogId: string | null; alerts: NotifyAlert[]; update?: string | null },
  cfg: WhatsAppConfig,
  deps: NotifyDeps,
  whatsappOk = true
): Promise<{ whatsapp: WhatsAppOutcome; emailed: number }> {
  const prefs = person.notificationPreferences;
  const minLevel = prefs ? prefs.minimumAlertLevel : 1;
  const topLevel = input.alerts.reduce((m, a) => Math.max(m, a.level), 0);
  // Daily-summary mode: routine results wait for the evening summary.
  if (prefs?.dailySummary && topLevel < 2) return { whatsapp: 'not_wanted', emailed: 0 };

  const plan = planFamilyMessage({
    parentName: parent.name,
    parentPhone: parent.phone,
    alerts: input.alerts,
    update: input.update,
    minimumAlertLevel: minLevel
  });
  if (!plan) return { whatsapp: 'not_wanted', emailed: 0 };

  // Over the plan's WhatsApp allowance: dashboard only, but level 3-4 alerts still go by email.
  const to = whatsappOk ? whatsappRecipient(person) : null;
  if (!to) return { whatsapp: 'not_opted_in', emailed: await emailSafetyFallback(person, parent.name, input.alerts, deps) };

  let row;
  try {
    row = await prisma.whatsAppMessage.create({
      data: {
        id: newId('wam'),
        userId: person.id,
        parentId: parent.id,
        callLogId: input.callLogId,
        alertId: plan.alertId,
        kind: plan.kind,
        // One message per call (or alert) and number; a call's later result with a different top alert (e.g. a late
        // result after "no result received") is its own message rather than a silent duplicate.
        refKey: `${input.callLogId ? `${input.callLogId}${plan.alertId ? `:${plan.alertId}` : ''}` : plan.alertId || newId('ref')}:${to}`,
        phone: to,
        templateName: WHATSAPP_TEMPLATES[plan.kind].name,
        body: plan.body,
        level: plan.level
      }
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { whatsapp: 'duplicate', emailed: 0 };
    throw err;
  }

  try {
    const { messageId } = await sendTemplate(cfg, to, plan.kind, plan.params, deps.fetchImpl);
    await prisma.whatsAppMessage.update({ where: { id: row.id }, data: { status: 'sent', providerMessageId: messageId } });
    const ids = input.alerts.map(a => a.id);
    if (ids.length) await prisma.alertRecord.updateMany({ where: { id: { in: ids } }, data: { channel: 'whatsapp' } });
    return { whatsapp: 'sent', emailed: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error(`[notify] WhatsApp to ${person.id} failed: ${message}`);
    await prisma.whatsAppMessage.update({ where: { id: row.id }, data: { status: 'failed', error: message.slice(0, 300) } });
    const emailed = plan.level >= 3 ? await claimAndEmailFallback(row.id, deps) : 0;
    return { whatsapp: 'failed', emailed };
  }
}

export async function notifyFamily(
  input: { parentId: string; callLogId: string | null; alerts: NotifyAlert[]; update?: string | null },
  deps: NotifyDeps = {}
): Promise<NotifyResult> {
  const fam = await familyRecipients(input.parentId);
  if (!fam) return { whatsapp: 'not_wanted', emailed: 0 };
  const people: Person[] = [fam.owner, ...fam.members];

  const cfg = deps.whatsapp !== undefined ? deps.whatsapp : getWhatsAppConfig();
  if (!cfg) {
    // Before WhatsApp is live: the original alert emails (level 2+, within each person's settings).
    let emailed = 0;
    for (const person of people) {
      const prefs = person.notificationPreferences;
      const emailAllowed = prefs ? prefs.email : true;
      const minLevel = prefs ? prefs.minimumAlertLevel : 1;
      const wanted = input.alerts.filter(a => a.level >= 2 && a.level >= minLevel);
      if (emailAllowed && wanted.length) emailed += await emailAlertsTo(person, fam.parent.name, wanted, deps);
    }
    return { whatsapp: 'not_configured', emailed, people: people.map(p => ({ userId: p.id, whatsapp: 'not_configured' })) };
  }

  // Routine updates: only the plan's allowance. Emergencies (level 4) reach everyone who opted in: safety isn't tiered.
  const emergency = input.alerts.some(a => a.level >= 4);
  const allowed = emergency ? null : whatsappAllowed(people, (await ownerPlanFor(fam.parent.userId)).whatsappPeople);
  let emailed = 0;
  let seriousFailure: unknown = null;
  const outcomes: { userId: string; whatsapp: WhatsAppOutcome }[] = [];
  for (const person of people) {
    try {
      const r = await notifyPerson(person, fam.parent, input, cfg, deps, !allowed || allowed.has(person.id));
      emailed += r.emailed;
      outcomes.push({ userId: person.id, whatsapp: r.whatsapp });
    } catch (err) {
      // One person's failure must not stop the rest of the family hearing about it.
      console.error(`[notify] Notifying ${person.id} failed:`, err);
      outcomes.push({ userId: person.id, whatsapp: 'failed' });
      // A serious alert: email them instead, and let the caller's retry (Sarvam / Meta) try them again afterwards
      // (people already sent are skipped then: one message per call / alert and number).
      if (input.alerts.some(a => a.level >= 3)) {
        emailed += await emailSafetyFallback(person, fam.parent.name, input.alerts, deps).catch(() => 0);
        seriousFailure = err;
      }
    }
  }
  if (seriousFailure) throw seriousFailure;
  return { whatsapp: outcomes[0]?.whatsapp || 'not_wanted', emailed, people: outcomes };
}

/**
 * A level 3-4 WhatsApp message failed (when sending, or later in Meta's status
 * webhook): email that call's serious alerts to the person it was for, once.
 */
export async function claimAndEmailFallback(messageId: string, deps: NotifyDeps = {}): Promise<number> {
  const claimed = await prisma.whatsAppMessage.updateMany({
    where: { id: messageId, fallbackEmailedAt: null, level: { gte: 3 } },
    data: { fallbackEmailedAt: new Date() }
  });
  if (claimed.count !== 1) return 0;
  const msg = await prisma.whatsAppMessage.findUnique({ where: { id: messageId } });
  if (!msg?.parentId || !msg.userId) return 0;
  const [parent, person] = await Promise.all([
    prisma.parentProfile.findUnique({ where: { id: msg.parentId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: msg.userId }, include: { notificationPreferences: true } })
  ]);
  if (!parent || !person) return 0;
  const alerts = await prisma.alertRecord.findMany({
    where: msg.callLogId ? { callLogId: msg.callLogId, level: { gte: 3 } } : { id: msg.alertId || '', level: { gte: 3 } }
  });
  const sent = await emailSafetyFallback(person, parent.name, alerts, deps);
  // Nothing went out though email is allowed (the email service failed): release the claim so it can be tried again.
  if (sent === 0 && alerts.length && person.notificationPreferences?.email !== false) {
    await prisma.whatsAppMessage.update({ where: { id: messageId }, data: { fallbackEmailedAt: null } });
  }
  return sent;
}

/**
 * "X is handling it": everyone in the family except the person who said "I'm on it".
 * WhatsApp when configured and opted in; otherwise email, because during an emergency
 * the family must know someone is acting.
 */
export async function notifyHandled(
  input: { parentId: string; alertId: string | null; handlerName: string; exceptUserId: string | null },
  deps: NotifyDeps = {}
): Promise<number> {
  const fam = await familyRecipients(input.parentId);
  if (!fam) return 0;
  const cfg = deps.whatsapp !== undefined ? deps.whatsapp : getWhatsAppConfig();
  const params = [cleanParam(fam.parent.name, 60), cleanParam(input.handlerName, 80)];
  let told = 0;
  for (const person of [fam.owner, ...fam.members]) {
    if (person.id === input.exceptUserId) continue;
    const to = cfg ? whatsappRecipient(person) : null;
    if (cfg && to) {
      try {
        const row = await prisma.whatsAppMessage.create({
          data: {
            id: newId('wam'),
            userId: person.id,
            parentId: fam.parent.id,
            alertId: input.alertId,
            kind: 'handled',
            refKey: `${input.alertId || newId('ref')}:handled:${to}`,
            phone: to,
            templateName: WHATSAPP_TEMPLATES.handled.name,
            body: renderTemplate('handled', params),
            level: 0
          }
        });
        const { messageId } = await sendTemplate(cfg, to, 'handled', params, deps.fetchImpl);
        await prisma.whatsAppMessage.update({ where: { id: row.id }, data: { status: 'sent', providerMessageId: messageId } });
        told += 1;
        continue;
      } catch (err) {
        if (isUniqueViolation(err)) continue;
        console.error(`[notify] "Handled" WhatsApp to ${person.id} failed:`, err);
      }
    }
    if (person.notificationPreferences?.email === false) continue;
    const sendEmail = deps.sendEmail || sendUrgentAlertEmail;
    const res = await sendEmail({
      to: person.email,
      name: person.name,
      parentName: fam.parent.name,
      alertLevel: 'level_2',
      alertType: `${input.handlerName} is handling the urgent alert`,
      summary: `${input.handlerName} said they are handling the urgent alert about ${fam.parent.name}. You don't need to do anything unless they ask you.`,
      actionUrl: `${appUrl()}/dashboard`
    }).catch(() => ({ success: false }));
    if (res.success) told += 1;
  }
  return told;
}

export type SummaryPeriod = 'daily' | 'weekly' | 'monthly';

/**
 * One summary to one person, once per period (`refKey`). WhatsApp when they opted in;
 * email only while WhatsApp isn't set up at all (same rule as alerts).
 */
export async function sendSummary(
  input: { person: Person; period: SummaryPeriod; refKey: string; parentNames: string; text: string; reportUrl?: string },
  deps: NotifyDeps & { sendSummaryEmail?: typeof sendCareSummaryEmail } = {}
): Promise<'whatsapp' | 'email' | 'skipped' | 'duplicate' | 'failed'> {
  const cfg = deps.whatsapp !== undefined ? deps.whatsapp : getWhatsAppConfig();
  if (cfg) {
    const to = whatsappRecipient(input.person);
    if (!to) return 'skipped';
    const params = [input.period, cleanParam(input.parentNames, 120), cleanParam(input.text, 650)];
    let row;
    try {
      row = await prisma.whatsAppMessage.create({
        data: {
          id: newId('wam'),
          userId: input.person.id,
          kind: `summary_${input.period}`,
          refKey: `${input.person.id}:${input.refKey}`,
          phone: to,
          templateName: WHATSAPP_TEMPLATES.summary.name,
          body: renderTemplate('summary', params),
          level: 0
        }
      });
    } catch (err) {
      if (isUniqueViolation(err)) return 'duplicate';
      throw err;
    }
    try {
      const { messageId } = await sendTemplate(cfg, to, 'summary', params, deps.fetchImpl);
      await prisma.whatsAppMessage.update({ where: { id: row.id }, data: { status: 'sent', providerMessageId: messageId } });
      return 'whatsapp';
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      await prisma.whatsAppMessage.update({ where: { id: row.id }, data: { status: 'failed', error: message.slice(0, 300) } });
      return 'failed';
    }
  }

  if (input.person.notificationPreferences?.email === false) return 'skipped';
  const send = deps.sendSummaryEmail || sendCareSummaryEmail;
  // Fail-closed like the other cron emails: without a record it would repeat every run.
  const res = await sendOnce({ userId: input.person.id, kind: `summary_${input.period}`, refKey: input.refKey, failOpen: false }, () =>
    send({
      to: input.person.email,
      name: input.person.name,
      period: input.period,
      parentNames: input.parentNames,
      text: input.text,
      actionUrl: input.reportUrl || `${appUrl()}/dashboard`
    })
  );
  return res === 'sent' ? 'email' : res;
}
