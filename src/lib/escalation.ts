/**
 * Emergency escalation: Aaptha can spot an emergency in seconds, but only someone
 * near the parent can act. Each level-4 alert (and each wellness check for a parent
 * who lives alone) is worked through a ladder of people until one of them says
 * "I'm on it". See docs/v1-care-plan.md §1.
 *
 *   emergency       round 0: phone call to the account owner (wakes them abroad) + the first local contact
 *                   then every ESCALATION_STEP_MINUTES: next contact, the parent again, remaining contacts
 *   wellness_check  local contacts one by one ("please check on Amma, we couldn't reach her")
 *   practice        one practice call to one contact, nothing else
 *
 * WhatsApp to the family is sent by notifyFamily when the alert is raised; this module adds the
 * phone calls (the "Aaptha Alert" Sarvam agent), "I'm on it" handling and "X is handling it" updates.
 * Every step is claimed in the database, so overlapping cron runs and repeated webhooks are safe.
 */
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { newId } from './db';
import { normalizePhone } from './phone';
import {
  SarvamConfig, AlertAgentConfig, AlertCallKind, getSarvamConfig, getAlertAgentConfig, createAlertCall, SarvamApiError,
  isProviderAccountProblem, logProviderProblem
} from './sarvam';
import { ALERT_TITLES, SarvamWebhookPayload, agentVariables } from './callInterpretation';
import { recordAlert } from './alerts';
import { notifyFamily, notifyHandled, NotifyDeps } from './familyNotify';
import { EscalationSummary } from './types';

export const ESCALATION_STEP_MINUTES = 10;
/** Practice calls per parent per day (each one costs a call). */
export const MAX_PRACTICE_PER_DAY = 3;

export type EscalationKind = 'emergency' | 'wellness_check' | 'practice';

export interface EscalationDeps extends NotifyDeps {
  now?: Date;
  /** undefined = read the environment; null = calling off (tests). */
  config?: SarvamConfig | null;
  alertAgent?: AlertAgentConfig | null;
}

export interface LadderTarget {
  targetType: 'owner' | 'contact' | 'parent';
  targetId: string;
  name: string;
  phone: string;
  callKind: AlertCallKind;
}

export interface LadderContact {
  id: string;
  name: string;
  phone: string;
  isLocal: boolean;
  priority: string;
  createdAt: Date;
}

const digits = (p: string) => p.replace(/\D/g, '');

/** Local contacts first, then the family's order (primary before backups). */
export function orderContacts<T extends LadderContact>(contacts: T[]): T[] {
  return [...contacts].sort((a, b) => {
    if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
    if (a.priority !== b.priority) return a.priority === 'primary' ? -1 : 1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

/**
 * The rounds of an escalation, in order. Pure, so the ladder is easy to test.
 * A contact whose number is the owner's (the default contact) isn't phoned twice.
 */
export function ladderRounds(input: {
  kind: EscalationKind;
  owner: { id: string; name: string; phone: string | null; wake: boolean };
  parent: { id: string; name: string; phone: string };
  contacts: LadderContact[];
  practiceContactId?: string | null;
}): LadderTarget[][] {
  const ownerDigits = input.owner.phone ? digits(input.owner.phone) : '';
  const contacts = orderContacts(input.contacts).filter(c => c.phone && digits(c.phone) !== digits(input.parent.phone));
  const asTarget = (c: LadderContact, callKind: AlertCallKind): LadderTarget => ({
    targetType: 'contact', targetId: c.id, name: c.name, phone: c.phone, callKind
  });

  if (input.kind === 'practice') {
    const c = input.contacts.find(x => x.id === input.practiceContactId);
    return c ? [[asTarget(c, 'practice')]] : [];
  }

  if (input.kind === 'wellness_check') {
    // The owner already has the "couldn't reach" alert; ask the people who can go there.
    return contacts.filter(c => digits(c.phone) !== ownerDigits).map(c => [asTarget(c, 'wellness_check')]);
  }

  const wakeOwner = input.owner.wake && !!input.owner.phone;
  const helpers = contacts.filter(c => !(wakeOwner && digits(c.phone) === ownerDigits));
  const rounds: LadderTarget[][] = [];
  const first: LadderTarget[] = [];
  if (wakeOwner) {
    first.push({ targetType: 'owner', targetId: input.owner.id, name: input.owner.name, phone: input.owner.phone!, callKind: 'emergency' });
  }
  if (helpers[0]) first.push(asTarget(helpers[0], 'emergency'));
  if (first.length) rounds.push(first);
  if (helpers[1]) rounds.push([asTarget(helpers[1], 'emergency')]);
  rounds.push([{ targetType: 'parent', targetId: input.parent.id, name: input.parent.name, phone: input.parent.phone, callKind: 'parent_check' }]);
  for (const c of helpers.slice(2)) rounds.push([asTarget(c, 'emergency')]);
  return rounds;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

async function loadContext(escalationId: string) {
  const esc = await prisma.escalation.findUnique({
    where: { id: escalationId },
    include: {
      attempts: true,
      parent: {
        include: {
          emergencyContacts: true,
          user: { include: { notificationPreferences: true } }
        }
      }
    }
  });
  return esc;
}

function ownerForLadder(user: { id: string; name: string; phone: string | null; notificationPreferences: { wakeForEmergency: boolean; emergencyPhone: string | null } | null }) {
  const prefs = user.notificationPreferences;
  const raw = prefs?.emergencyPhone || user.phone || '';
  const norm = normalizePhone(raw);
  return { id: user.id, name: user.name, phone: norm.ok ? norm.e164 : null, wake: prefs ? prefs.wakeForEmergency : true };
}

function roundsFor(esc: NonNullable<Awaited<ReturnType<typeof loadContext>>>, practiceContactId?: string | null) {
  const p = esc.parent;
  return ladderRounds({
    kind: esc.kind as EscalationKind,
    owner: ownerForLadder(p.user),
    parent: { id: p.id, name: p.name, phone: p.phone },
    contacts: p.emergencyContacts.map(c => {
      const n = normalizePhone(c.phone);
      return { id: c.id, name: c.name, phone: n.ok ? n.e164 : '', isLocal: c.isLocal, priority: c.priority, createdAt: c.createdAt };
    }),
    practiceContactId
  });
}

async function placeAttempt(
  esc: NonNullable<Awaited<ReturnType<typeof loadContext>>>,
  round: number,
  target: LadderTarget,
  deps: EscalationDeps
) {
  const attempt = await prisma.escalationAttempt.create({
    data: {
      id: newId('esa'),
      escalationId: esc.id,
      round,
      targetType: target.targetType,
      targetId: target.targetId,
      name: target.name,
      phone: target.phone,
      channel: 'call'
    }
  });
  const cfg = deps.config !== undefined ? deps.config : getSarvamConfig();
  const agent = deps.alertAgent !== undefined ? deps.alertAgent : getAlertAgentConfig();
  if (!cfg || !agent) {
    await prisma.escalationAttempt.update({
      where: { id: attempt.id },
      data: { status: 'failed', failureReason: 'alert_agent_not_configured' }
    });
    return;
  }
  try {
    const { attemptId } = await createAlertCall(
      cfg,
      agent,
      {
        attemptId: attempt.id,
        escalationId: esc.id,
        kind: target.callKind,
        recipientName: target.name,
        recipientPhone: target.phone,
        parentName: esc.parent.name,
        parentPhone: esc.parent.phone,
        parentAddress: esc.parent.address,
        familyName: esc.parent.user.name,
        reason: esc.reason,
        language: esc.parent.language
      },
      deps.fetchImpl
    );
    await prisma.escalationAttempt.update({ where: { id: attempt.id }, data: { status: 'placed', providerAttemptId: attemptId } });
  } catch (err) {
    const status = err instanceof SarvamApiError ? err.status : undefined;
    if (isProviderAccountProblem(status)) logProviderProblem(status);
    await prisma.escalationAttempt.update({
      where: { id: attempt.id },
      data: { status: 'failed', failureReason: (err instanceof Error ? err.message : 'call failed').slice(0, 300) }
    });
  }
}

/** Runs one round of the ladder (or finishes the escalation when the ladder is used up). */
async function runRound(escalationId: string, round: number, deps: EscalationDeps, practiceContactId?: string | null) {
  const now = deps.now || new Date();
  const esc = await loadContext(escalationId);
  if (!esc || esc.status !== 'active') return;
  const rounds = roundsFor(esc, practiceContactId);

  if (round >= rounds.length) {
    await exhaust(esc.id, deps);
    return;
  }
  for (const target of rounds[round]) await placeAttempt(esc, round, target, deps);
  await prisma.escalation.update({
    where: { id: esc.id },
    data: {
      round,
      // Practice calls have no ladder: the webhook closes them.
      nextStepAt: esc.kind === 'practice' ? null : new Date(now.getTime() + ESCALATION_STEP_MINUTES * 60000)
    }
  });
}

/** Nobody said yes: tell the family plainly, once. */
async function exhaust(escalationId: string, deps: EscalationDeps) {
  const claimed = await prisma.escalation.updateMany({
    where: { id: escalationId, status: 'active' },
    data: { status: 'exhausted', nextStepAt: null }
  });
  if (claimed.count !== 1) return;
  const esc = await prisma.escalation.findUnique({ where: { id: escalationId }, include: { parent: true } });
  if (!esc || esc.kind === 'practice') return;
  const alert = esc.alertId ? await prisma.alertRecord.findUnique({ where: { id: esc.alertId } }) : null;
  const name = esc.parent.name;
  const rec = await recordAlert({
    parentId: esc.parentId,
    callLogId: alert?.callLogId || null,
    level: 3,
    title: ALERT_TITLES.escalationExhausted,
    message:
      esc.kind === 'emergency'
        ? `We phoned everyone on ${name}'s emergency list and nobody has said they are helping yet. Please call ${name} now. If you can't reach them and it may be serious, call 112 or someone near them.`
        : `We couldn't reach ${name}, and none of their local contacts could check on them. Please try calling ${name} or someone near them.`
  });
  if (rec.alert) await notifyFamily({ parentId: esc.parentId, callLogId: null, alerts: [rec.alert] }, deps);
}

/**
 * Starts an escalation (idempotent per alert) and runs its first round straight away.
 * Returns null when one already exists for this alert.
 */
export async function startEscalation(
  input: { parentId: string; alertId: string | null; kind: EscalationKind; reason: string; practiceContactId?: string },
  deps: EscalationDeps = {}
): Promise<{ id: string } | null> {
  let esc;
  try {
    esc = await prisma.escalation.create({
      data: {
        id: newId('esc'),
        parentId: input.parentId,
        alertId: input.alertId,
        kind: input.kind,
        reason: input.reason.replace(/\s+/g, ' ').trim().slice(0, 300) || 'They may need help.'
      }
    });
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
  try {
    await runRound(esc.id, 0, deps, input.practiceContactId);
  } catch (err) {
    // The family already has the WhatsApp/email alert; a failed call round must not lose the escalation.
    console.error('[escalation] First round failed:', err);
    await prisma.escalation.update({
      where: { id: esc.id },
      data: { nextStepAt: new Date((deps.now || new Date()).getTime() + ESCALATION_STEP_MINUTES * 60000) }
    });
  }
  return { id: esc.id };
}

/** Cron: moves every active escalation whose step is due to its next round. */
export async function advanceEscalations(deps: EscalationDeps & { parentIds?: string[] } = {}): Promise<{ advanced: number }> {
  const now = deps.now || new Date();
  const due = await prisma.escalation.findMany({
    where: {
      status: 'active',
      nextStepAt: { lte: now },
      ...(deps.parentIds ? { parentId: { in: deps.parentIds } } : {})
    },
    take: 50
  });
  let advanced = 0;
  for (const esc of due) {
    const claimed = await prisma.escalation.updateMany({
      where: { id: esc.id, status: 'active', nextStepAt: esc.nextStepAt },
      data: { nextStepAt: null }
    });
    if (claimed.count !== 1) continue;
    try {
      await runRound(esc.id, esc.round + 1, deps);
      advanced += 1;
    } catch (err) {
      console.error(`[escalation] Round ${esc.round + 1} of ${esc.id} failed:`, err);
      // The claim above cleared nextStepAt; without this the emergency would sit "active" forever and nobody
      // would be told. Try the round again on a later tick.
      try {
        await prisma.escalation.updateMany({
          where: { id: esc.id, status: 'active', nextStepAt: null },
          data: { nextStepAt: new Date(now.getTime() + 2 * 60000) }
        });
      } catch (restoreErr) {
        console.error(`[escalation] Could not reschedule ${esc.id}:`, restoreErr);
      }
    }
  }
  return { advanced };
}

/**
 * Someone said "I'm on it" (WhatsApp button, "yes" on an alert call, or the dashboard).
 * Stops the ladder and tells everyone else who is handling it. Safe to call twice.
 */
export async function markHandled(
  escalationId: string,
  by: { name: string; phone?: string | null; via: 'whatsapp' | 'call' | 'dashboard'; userId?: string | null },
  deps: EscalationDeps = {}
): Promise<{ handled: boolean; handledByName: string | null }> {
  const now = deps.now || new Date();
  const claimed = await prisma.escalation.updateMany({
    where: { id: escalationId, status: 'active' },
    data: { status: 'handled', handledByName: by.name, handledByPhone: by.phone || null, handledVia: by.via, handledAt: now, nextStepAt: null }
  });
  const esc = await prisma.escalation.findUnique({ where: { id: escalationId } });
  if (claimed.count !== 1 || !esc) return { handled: false, handledByName: esc?.handledByName || null };

  if (esc.alertId) {
    await prisma.alertRecord.updateMany({
      where: { id: esc.alertId },
      data: { acknowledgedAt: now, status: 'resolved', handledByName: by.name, handledVia: by.via }
    });
  }
  if (esc.kind !== 'practice') {
    await notifyHandled({ parentId: esc.parentId, alertId: esc.alertId, handlerName: by.name, exceptUserId: by.userId || null }, deps);
  }
  return { handled: true, handledByName: by.name };
}

/** The escalation for an alert, if any (used by the WhatsApp "I'll handle it" button). */
export async function escalationForAlert(alertId: string) {
  return prisma.escalation.findUnique({ where: { alertId } });
}

/** The family records what happened afterwards; this closes the alert and its escalation. */
export async function recordOutcome(
  input: { alertId: string; parentId: string; outcome: 'fine' | 'doctor_visit' | 'hospital' | 'other'; note?: string | null; userId: string; userName: string },
  deps: EscalationDeps = {}
): Promise<boolean> {
  const now = deps.now || new Date();
  const res = await prisma.alertRecord.updateMany({
    where: { id: input.alertId, parentId: input.parentId },
    data: {
      outcome: input.outcome,
      outcomeNote: input.note ? input.note.slice(0, 500) : null,
      outcomeAt: now,
      outcomeById: input.userId,
      status: 'resolved'
    }
  });
  if (res.count !== 1) return false;
  const esc = await prisma.escalation.findUnique({ where: { alertId: input.alertId } });
  if (esc && esc.status !== 'closed') {
    if (esc.status === 'active') {
      // Recording an outcome means someone dealt with it: stop calling people.
      await markHandled(esc.id, { name: input.userName, via: 'dashboard', userId: input.userId }, deps);
    }
    await prisma.escalation.update({ where: { id: esc.id }, data: { status: 'closed', closedAt: now, nextStepAt: null } });
  }
  return true;
}

function normaliseResponse(value: unknown): 'yes' | 'no' | 'unclear' {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['yes', 'true', 'on_it', 'ok', 'okay'].includes(v)) return 'yes';
  if (['no', 'false', 'cannot', "can't"].includes(v)) return 'no';
  return 'unclear';
}

/** True when this end-of-call webhook belongs to an Aaptha Alert call. */
export async function findAlertAttempt(attemptId: string, metadata: unknown) {
  if (attemptId) {
    const byProvider = await prisma.escalationAttempt.findUnique({ where: { providerAttemptId: attemptId } });
    if (byProvider) return byProvider;
  }
  const meta = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};
  const id = typeof meta.escalationAttemptId === 'string' ? meta.escalationAttemptId : '';
  if (!id) return null;
  const byId = await prisma.escalationAttempt.findUnique({ where: { id } });
  return byId && (!byId.providerAttemptId || byId.providerAttemptId === attemptId) ? byId : null;
}

/** Applies the end-of-call result of an Aaptha Alert call. Idempotent. */
export async function processAlertCallResult(
  attemptRowId: string,
  payload: SarvamWebhookPayload,
  deps: EscalationDeps = {}
): Promise<'processed' | 'duplicate'> {
  const now = deps.now || new Date();
  const status = typeof payload.status === 'string' ? payload.status : 'failed';
  const connected = status === 'connected';
  const response = connected ? normaliseResponse(agentVariables(payload).response) : null;
  const finalStatus = connected ? 'answered' : status === 'busy' ? 'busy' : status === 'no_answer' ? 'no_answer' : 'failed';

  const claimed = await prisma.escalationAttempt.updateMany({
    where: { id: attemptRowId, respondedAt: null },
    data: {
      status: finalStatus,
      response,
      respondedAt: now,
      providerAttemptId: typeof payload.attempt_id === 'string' && payload.attempt_id ? payload.attempt_id : undefined,
      failureReason: typeof payload.failure_reason === 'string' ? payload.failure_reason.slice(0, 300) : null
    }
  });
  if (claimed.count !== 1) return 'duplicate';

  const attempt = await prisma.escalationAttempt.findUnique({ where: { id: attemptRowId }, include: { escalation: { include: { parent: true } } } });
  if (!attempt) return 'duplicate';
  const esc = attempt.escalation;

  if (esc.kind === 'practice') {
    if (attempt.targetType === 'contact' && attempt.targetId) {
      await prisma.emergencyContact.updateMany({
        where: { id: attempt.targetId },
        data: { practiceAt: connected ? now : null, practiceResult: connected ? response : finalStatus }
      });
    }
    await prisma.escalation.update({ where: { id: esc.id }, data: { status: 'closed', closedAt: now, nextStepAt: null } });
    return 'processed';
  }

  if (attempt.targetType === 'parent') {
    if (connected && response === 'yes') {
      // Reassuring, but someone should still check: the ladder carries on until a person says "I'm on it".
      const rec = await recordAlert({
        parentId: esc.parentId,
        callLogId: null,
        level: 2,
        title: `${esc.parent.name} answered and said they are okay`,
        message: `Saathi called ${esc.parent.name} again after the urgent alert and they said they are okay. Please still speak to them yourself, or tap "I'm on it" on the dashboard so we stop calling their contacts.`
      });
      if (rec.alert) await notifyFamily({ parentId: esc.parentId, callLogId: null, alerts: [rec.alert] }, deps);
    }
    return 'processed';
  }

  if (connected && response === 'yes') {
    await markHandled(
      esc.id,
      { name: attempt.name, phone: attempt.phone, via: 'call', userId: attempt.targetType === 'owner' ? attempt.targetId : null },
      deps
    );
  }
  return 'processed';
}

/** A practice alert call to one contact, so they know what a real alert sounds like. */
export async function startPracticeAlert(
  input: { parentId: string; contactId: string },
  deps: EscalationDeps = {}
): Promise<{ ok: true; escalationId: string } | { ok: false; status: number; error: string }> {
  const now = deps.now || new Date();
  const contact = await prisma.emergencyContact.findFirst({ where: { id: input.contactId, parentId: input.parentId } });
  if (!contact) return { ok: false, status: 404, error: 'Contact not found.' };
  const cfg = deps.config !== undefined ? deps.config : getSarvamConfig();
  const agent = deps.alertAgent !== undefined ? deps.alertAgent : getAlertAgentConfig();
  if (!cfg || !agent) {
    return { ok: false, status: 503, error: 'Practice alerts start once emergency calling is connected. Nothing was sent.' };
  }
  const today = await prisma.escalation.count({
    where: { parentId: input.parentId, kind: 'practice', createdAt: { gte: new Date(now.getTime() - 86400000) } }
  });
  if (today >= MAX_PRACTICE_PER_DAY) return { ok: false, status: 429, error: 'Too many practice alerts today. Please try again tomorrow.' };

  const parent = await prisma.parentProfile.findUnique({ where: { id: input.parentId }, select: { name: true } });
  const esc = await startEscalation(
    {
      parentId: input.parentId,
      alertId: null,
      kind: 'practice',
      reason: `This is a practice alert for ${parent?.name || 'your family member'}. Nothing is wrong.`,
      practiceContactId: contact.id
    },
    deps
  );
  if (!esc) return { ok: false, status: 409, error: 'A practice alert is already running.' };
  return { ok: true, escalationId: esc.id };
}

/** Dashboard view of an alert's escalation. */
export function toEscalationSummary(esc: Prisma.EscalationGetPayload<{ include: { attempts: true } }>): EscalationSummary {
  return {
    id: esc.id,
    kind: esc.kind as EscalationSummary['kind'],
    status: esc.status as EscalationSummary['status'],
    round: esc.round,
    handledByName: esc.handledByName || undefined,
    handledVia: esc.handledVia || undefined,
    handledAt: esc.handledAt?.toISOString(),
    nextStepAt: esc.nextStepAt?.toISOString(),
    attempts: [...esc.attempts]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(a => ({
        name: a.name,
        channel: a.channel,
        status: a.status,
        response: a.response || undefined,
        createdAt: a.createdAt.toISOString(),
        targetType: a.targetType
      }))
  };
}
