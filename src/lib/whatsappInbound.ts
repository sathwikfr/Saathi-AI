/**
 * Meta's WhatsApp webhook: delivery statuses for our messages, and what the
 * family sends back (button taps, STOP / START, any other text).
 *
 * Safe to receive twice (Meta retries): inbound messages are unique by their
 * WhatsApp id, and statuses only ever move forward.
 * Button taps only act on the message they were tapped on, and only when the
 * tapping number is the number we sent it to.
 */
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { newId } from './db';
import Anthropic from '@anthropic-ai/sdk';
import { WhatsAppConfig, getWhatsAppConfig, sendText, downloadMedia, WA_PAYLOAD } from './whatsapp';
import { checkForScam, fallbackReply } from './scamCheck';
import { recordAlert, notifyThenEscalate, RecordAlertResult } from './alerts';
import { scanMessage, scanSymptomMessage } from './safety';
import { ALERT_TITLES } from './callInterpretation';
import { notifyFamily } from './familyNotify';
import { WA_REPLIES } from './familyMessages';
import { claimAndEmailFallback, NotifyDeps } from './familyNotify';
import { placeManualCall, DispatchDeps } from './callDispatch';
import { escalationForAlert, markHandled } from './escalation';
import { handleReminderInbound, parsePauseToday, pausedPastToday, tomorrowStartIst } from './reminders';
import { parseClockTime, istDateString } from './ist';
import { parentRoleFor, roleAllows } from './familyAccess';

export interface InboundDeps extends NotifyDeps {
  now?: Date;
  /** Passed to placeManualCall for "Call again" (tests inject a fake Sarvam). */
  dispatch?: DispatchDeps;
  /** Scam check model client (undefined = from the environment, null = off). */
  claude?: Anthropic | null;
}

/** Scam checks a parent can ask for in 24 hours (each one is a Claude request). */
export const MAX_SCAM_CHECKS_PER_DAY = 20;
export const SCAM_ALERT_TITLE = 'Possible scam message';
export const PARENT_EMERGENCY_TITLE = 'Possible emergency in a WhatsApp message';
/** One alert and one calling ladder per this many minutes for a parent's emergency texts. */
export const PARENT_EMERGENCY_GAP_MINUTES = 30;
/** A parent's everyday symptoms on WhatsApp: the family is told at once, then at most once per this many hours. */
export const PARENT_UNWELL_GAP_HOURS = 2;

export const PARENT_PAUSE_TITLE = 'Asked for no calls today';

export const PARENT_REPLIES = {
  pausedToday: (time: string | null) =>
    `OK, Saathi won't call again today. Saathi will call you tomorrow${time ? ` at ${time.replace(/^0/, '')}` : ''}.`,
  emergency: (family: string) =>
    `This sounds like it could be urgent. Please call 108 for an ambulance or 112 now, or ask someone near you for help. I am letting ${family} know right away.`,
  unwell: (family: string) =>
    `Sorry you're not feeling well. I've let ${family} know. I can't give medical advice: please rest, and if it gets worse, see a doctor. In an emergency call 108.`
} as const;

export interface InboundSummary {
  statuses: number;
  messages: number;
  replies: number;
}

/** Hours between automatic "this number isn't read by a person" replies to one number. */
export const AUTO_REPLY_GAP_HOURS = 12;

const STATUS_RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
const STOP_WORDS = new Set(['stop', 'unsubscribe', 'stop all']);
const START_WORDS = new Set(['start', 'subscribe', 'unstop']);

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * The account a WhatsApp number belongs to: its WhatsApp setting first, then the account phone.
 * A number someone merely typed as their WhatsApp number only counts once that number has sent START (proof), except
 * for the START itself (`forStart`), which is how it gets proven.
 */
async function findUserByPhone(e164: string, forStart = false) {
  // The account whose OWN phone this is comes first (unless it deliberately points updates at another number): another
  // account that merely typed this number as its WhatsApp number must not be the one a START or STOP from it lands on.
  const own = await prisma.user.findFirst({
    where: {
      phone: e164,
      OR: [{ notificationPreferences: { is: null } }, { notificationPreferences: { is: { whatsappNumber: null } } }, { notificationPreferences: { is: { whatsappNumber: e164 } } }]
    }
  });
  if (own) return own;
  const pref = await prisma.notificationPreferences.findFirst({
    where: { whatsappNumber: e164, ...(forStart ? {} : { whatsappVerifiedAt: { not: null } }) },
    orderBy: { whatsappVerifiedAt: { sort: 'desc', nulls: 'last' } },
    select: { userId: true }
  });
  if (pref) return prisma.user.findUnique({ where: { id: pref.userId } });
  return prisma.user.findFirst({ where: { phone: e164 } });
}

async function reply(
  cfg: WhatsAppConfig | null,
  inbound: { id: string; phone: string; userId: string | null },
  text: string,
  deps: InboundDeps,
  kind: 'reply' | 'auto_reply' | 'scam_reply' = 'reply',
  parentId: string | null = null
): Promise<boolean> {
  if (!cfg) return false;
  const row = await prisma.whatsAppMessage.create({
    data: {
      id: newId('wam'),
      userId: inbound.userId,
      parentId,
      kind,
      refKey: `reply:${inbound.id}`,
      phone: inbound.phone,
      body: text
    }
  });
  try {
    const { messageId } = await sendText(cfg, inbound.phone, text, deps.fetchImpl);
    await prisma.whatsAppMessage.update({ where: { id: row.id }, data: { status: 'sent', providerMessageId: messageId } });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    await prisma.whatsAppMessage.update({ where: { id: row.id }, data: { status: 'failed', error: message.slice(0, 300) } });
    console.error('[whatsapp] Reply failed:', message);
    return false;
  }
}

async function handleStatus(st: Obj, deps: InboundDeps): Promise<boolean> {
  const id = str(st.id);
  const status = str(st.status);
  if (!id || !(status in STATUS_RANK)) return false;
  const row = await prisma.whatsAppMessage.findUnique({ where: { providerMessageId: id } });
  if (!row) return false;

  const err = obj(arr(st.errors)[0]);
  const errorText = status === 'failed'
    ? `${err.code ?? ''} ${str(err.title) || str(err.message)}`.trim().slice(0, 300) || 'failed'
    : undefined;
  const moved = await prisma.whatsAppMessage.updateMany({
    where: { id: row.id, status: { in: Object.keys(STATUS_RANK).filter(s => STATUS_RANK[s] < STATUS_RANK[status]) } },
    data: { status, ...(errorText ? { error: errorText } : {}) }
  });
  if (moved.count === 1 && status === 'failed' && row.level >= 3) {
    await claimAndEmailFallback(row.id, deps);
  }
  return moved.count === 1;
}

/**
 * The inbound row is stored first so a re-delivery is recognised, but if handling then fails (database error), the
 * row is removed again before the error goes up: Meta's retry must be processed from scratch, otherwise an
 * emergency message ("chest pain") would be remembered as "seen" and never reach the family.
 */
async function handleMessage(msg: Obj, cfg: WhatsAppConfig | null, deps: InboundDeps): Promise<number> {
  const claim: { rowId: string | null } = { rowId: null };
  try {
    return await handleMessageInner(msg, cfg, deps, claim);
  } catch (err) {
    if (claim.rowId) {
      try {
        await prisma.whatsAppMessage.deleteMany({ where: { id: claim.rowId, kind: 'inbound', direction: 'in' } });
      } catch (cleanupErr) {
        console.error('[whatsapp] Could not release an inbound message after a failure:', cleanupErr);
      }
    }
    throw err;
  }
}

async function handleMessageInner(msg: Obj, cfg: WhatsAppConfig | null, deps: InboundDeps, claim: { rowId: string | null }): Promise<number> {
  const waId = str(msg.id);
  const fromDigits = str(msg.from).replace(/\D/g, '');
  if (!waId || !fromDigits) return 0;
  const phone = `+${fromDigits}`;
  const type = str(msg.type);

  const payload =
    type === 'button' ? str(obj(msg.button).payload) || str(obj(msg.button).text)
    : type === 'interactive' ? str(obj(obj(msg.interactive).button_reply).id)
    : '';
  const text = type === 'text' ? str(obj(msg.text).body).trim() : '';
  // A photo's caption is read for warning words too ("chest pain" under a picture).
  const caption = type === 'image' ? str(obj(msg.image).caption).trim() : '';
  const word = text.toLowerCase().replace(/[.!]+$/, '').trim();

  // Meta re-delivers messages; the cheap check keeps the unique index (the backstop) out of the error log.
  if (await prisma.whatsAppMessage.findUnique({ where: { providerMessageId: waId }, select: { id: true } })) return 0;
  const user = await findUserByPhone(phone, START_WORDS.has(word));
  let inbound;
  try {
    inbound = await prisma.whatsAppMessage.create({
      data: {
        id: newId('wam'),
        userId: user?.id || null,
        direction: 'in',
        kind: 'inbound',
        refKey: waId,
        phone,
        body: (payload ? `[button] ${str(obj(msg.button).text) || payload}` : text || `[${type || 'message'}]`).slice(0, 2000),
        providerMessageId: waId,
        status: 'received'
      }
    });
  } catch (err) {
    if (isUniqueViolation(err)) return 0; // Meta re-delivered it
    throw err;
  }
  claim.rowId = inbound.id;
  // Medicine reminders on WhatsApp (Remind plan): START codes, Yes / Not yet, STOP, and anything the person writes.
  const reminderReplies = await handleReminderInbound(
    { inboundId: inbound.id, phone, type, text: text || caption, payload, contextId: str(obj(msg.context).id) },
    cfg,
    deps
  );
  if (reminderReplies !== null) return reminderReplies;

  // A parent's own messages: the emergency / symptom check, "pause today" and the scam check. This comes before the
  // account-holder handling, because a parent's number can also be someone's account or WhatsApp number (a parent who
  // has an account, a child who typed the parent's number, or anyone typing it without proof): their "chest pain"
  // must never end up as an account holder's message that gets at most an auto-reply. Only family buttons and
  // STOP / START from an account holder's number stay with the account.
  const familyCommand = payload === WA_PAYLOAD.ack || payload === WA_PAYLOAD.recall || STOP_WORDS.has(word) || START_WORDS.has(word);
  if (!user || !familyCommand) {
    const parent = await prisma.parentProfile.findFirst({
      where: { phone, isDeleted: false },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' }
    });
    if (parent) {
      await prisma.whatsAppMessage.update({ where: { id: inbound.id }, data: { parentId: parent.id } });
      return handleParentMessage(msg, type, text, parent, { id: inbound.id, phone }, cfg, deps);
    }
    // Numbers we don't know get no reply (keeps the number from answering spam).
    if (!user) return 0;
  }
  const target = { id: inbound.id, phone, userId: user.id };

  // ---- button taps: act on the message the button belongs to
  if (payload === WA_PAYLOAD.ack || payload === WA_PAYLOAD.recall) {
    const contextId = str(obj(msg.context).id);
    const original = contextId ? await prisma.whatsAppMessage.findUnique({ where: { providerMessageId: contextId } }) : null;
    if (!original || original.direction !== 'out' || original.phone !== phone) return 0;

    if (payload === WA_PAYLOAD.ack) {
      if (!original.alertId) return 0;
      // The tap must come from someone who is in this parent's family circle NOW: a member who was removed (or
      // left) still holds the old alert message and must not be able to stop the emergency calls with it.
      const alertRow = await prisma.alertRecord.findUnique({ where: { id: original.alertId }, select: { parentId: true } });
      if (!alertRow) return 0;
      const role = await parentRoleFor(user.id, alertRow.parentId);
      if (!roleAllows(role, 'view')) return 0;
      // Stopping the emergency calls is for the owner and co-managers; a view-only member is told to call instead.
      if (!roleAllows(role, 'manage')) {
        return (await reply(cfg, target, 'Only the person who manages this care can stop the emergency calls. Please call them yourself, or ask the owner of the Aaptha account.', deps)) ? 1 : 0;
      }
      // An urgent alert being escalated: "I'm on it" stops the calls and tells the rest of the family.
      const esc = await escalationForAlert(original.alertId);
      if (esc) {
        const res = await markHandled(esc.id, { name: user.name, phone, via: 'whatsapp', userId: user.id }, { ...deps, now: deps.now });
        const text = res.handled
          ? WA_REPLIES.acknowledged
          : res.handledByName && res.handledByName !== user.name
            ? WA_REPLIES.handledBy(res.handledByName)
            : WA_REPLIES.alreadyAcknowledged;
        return (await reply(cfg, target, text, deps)) ? 1 : 0;
      }
      const done = await prisma.alertRecord.updateMany({
        where: { id: original.alertId, acknowledgedAt: null },
        data: { acknowledgedAt: deps.now || new Date(), status: 'resolved', handledByName: user.name, handledVia: 'whatsapp' }
      });
      return (await reply(cfg, target, done.count === 1 ? WA_REPLIES.acknowledged : WA_REPLIES.alreadyAcknowledged, deps)) ? 1 : 0;
    }

    if (!original.parentId || original.userId !== user.id) return 0;
    const parent = await prisma.parentProfile.findUnique({ where: { id: original.parentId }, select: { name: true } });
    // placeManualCall checks this person may manage the parent (owner or co-manager).
    const result = await placeManualCall(
      { parentId: original.parentId, requesterId: user.id, kind: 'manual' },
      { ...deps.dispatch, now: deps.now }
    );
    const text = result.ok ? WA_REPLIES.calling(parent?.name || 'your parent') : WA_REPLIES.callFailed(result.error);
    return (await reply(cfg, target, text, deps)) ? 1 : 0;
  }

  // ---- STOP / START
  if (STOP_WORDS.has(word)) {
    await prisma.notificationPreferences.upsert({
      where: { userId: user.id },
      create: { userId: user.id, whatsapp: false, whatsappOptInAt: null },
      update: { whatsapp: false, whatsappOptInAt: null, whatsappVerifiedAt: null }
    });
    // STOP is about the number, not one account: every account that points updates at it stops (and must be proven again).
    await prisma.notificationPreferences.updateMany({
      where: { OR: [{ whatsappNumber: phone }, { user: { phone } }] },
      data: { whatsapp: false, whatsappOptInAt: null, whatsappVerifiedAt: null }
    });
    return (await reply(cfg, target, WA_REPLIES.stopped, deps)) ? 1 : 0;
  }
  if (START_WORDS.has(word)) {
    const now = deps.now || new Date();
    const number = user.phone === phone ? null : phone;
    await prisma.notificationPreferences.upsert({
      where: { userId: user.id },
      // Sending START from this number is the proof that it is theirs.
      create: { userId: user.id, whatsapp: true, whatsappOptInAt: now, whatsappVerifiedAt: now, whatsappNumber: number },
      update: { whatsapp: true, whatsappOptInAt: now, whatsappVerifiedAt: now, whatsappNumber: number }
    });
    return (await reply(cfg, target, WA_REPLIES.started, deps)) ? 1 : 0;
  }

  // ---- anything else: point them to the dashboard, at most once per AUTO_REPLY_GAP_HOURS
  const since = new Date((deps.now || new Date()).getTime() - AUTO_REPLY_GAP_HOURS * 3600000);
  const recent = await prisma.whatsAppMessage.count({
    where: { phone, kind: 'auto_reply', createdAt: { gte: since } }
  });
  if (recent > 0) return 0;
  const appUrl = cfg?.appUrl || (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  return (await reply(cfg, target, WA_REPLIES.autoReply(appUrl), deps, 'auto_reply')) ? 1 : 0;
}

async function handleParentMessage(
  msg: Obj,
  type: string,
  text: string,
  parent: { id: string; name: string; language: string; isPaused: boolean; pauseUntil: Date | null; user: { id: string; name: string } },
  inbound: { id: string; phone: string },
  cfg: WhatsAppConfig | null,
  deps: InboundDeps
): Promise<number> {
  if (!cfg) return 0;
  const now = deps.now || new Date();
  const familyName = parent.user.name.split(' ')[0] || 'your family';

  // Before the scam check (2026-10-05): words that may mean an emergency, then everyday symptoms. Never rate-limited.
  // A photo with a caption ("chest pain") counts too.
  const scanText = type === 'text' ? text : type === 'image' ? str(obj(msg.image).caption).trim() : '';
  if (scanText) {
    const emergency = scanMessage(scanText);
    if (emergency.hit) {
      const sent = await reply(cfg, { id: inbound.id, phone: inbound.phone, userId: null }, PARENT_REPLIES.emergency(familyName), deps, 'reply', parent.id);
      // The parent always gets the 108/112 reply, but one emergency starts one alert and one calling ladder: more
      // messages in the next half hour would otherwise re-ring family and neighbours every time (and cost money).
      const recentEmergency = await prisma.alertRecord.findFirst({
        where: { parentId: parent.id, title: PARENT_EMERGENCY_TITLE, createdAt: { gte: new Date(now.getTime() - PARENT_EMERGENCY_GAP_MINUTES * 60000) } },
        orderBy: { createdAt: 'desc' }
      });
      // ...unless that alert never got out (the attempt that recorded it failed before telling anyone): then it is
      // delivered now. Both steps are safe to repeat (one message per alert and number, one ladder per alert).
      const rec: RecordAlertResult = recentEmergency
        ? recentEmergency.channel === 'dashboard'
          ? { created: false, alertId: recentEmergency.id, alert: { id: recentEmergency.id, level: recentEmergency.level, title: recentEmergency.title, message: recentEmergency.message } }
          : { created: false, alertId: recentEmergency.id }
        : await recordAlert({
            parentId: parent.id,
            callLogId: null,
            level: 4,
            title: PARENT_EMERGENCY_TITLE,
            message: `${parent.name} sent Saathi a WhatsApp message with words that may mean an emergency (${emergency.matches.slice(0, 3).join(', ')}): "${scanText.slice(0, 200)}". Please call ${parent.name} right away. If it is serious, call 112 or ask someone nearby to go to them.`
          });
      if (rec.alert) {
        const alert = rec.alert;
        // The same calling ladder as an emergency heard on a call (family, then nearby contacts), even if the message fails.
        await notifyThenEscalate(
          parent.id,
          () => notifyFamily({ parentId: parent.id, callLogId: null, alerts: [alert] }, deps),
          [rec],
          scanText.slice(0, 200),
          { ...deps, now, config: deps.dispatch?.config }
        );
      }
      return sent ? 1 : 0;
    }

    // "pause today" (2026-10-05): no more calls today; they start again tomorrow by themselves. The family is told once
    // (otherwise they would only see calls not happening).
    if (type === 'text' && parsePauseToday(scanText)) {
      const slots = await prisma.scheduledCallSlot.findMany({ where: { parentId: parent.id, isActive: true }, select: { time: true } });
      const first = slots.map(s => s.time).sort((a, b) => (parseClockTime(a) ?? 0) - (parseClockTime(b) ?? 0))[0] || null;
      // A longer pause the family set is left alone, and the family hears about it once a day, not once per message.
      if (!pausedPastToday(parent, now)) {
        await prisma.parentProfile.update({
          where: { id: parent.id },
          data: { isPaused: true, pauseReason: `${parent.name} asked for no calls today (WhatsApp)`, pauseUntil: tomorrowStartIst(now) }
        });
      }
      const toldToday = await prisma.alertRecord.count({
        where: { parentId: parent.id, title: PARENT_PAUSE_TITLE, createdAt: { gte: new Date(`${istDateString(now)}T00:00:00+05:30`) } }
      });
      if (!toldToday) {
        const rec = await recordAlert({
          parentId: parent.id,
          callLogId: null,
          level: 2,
          title: PARENT_PAUSE_TITLE,
          message: `${parent.name} asked Saathi on WhatsApp not to call again today: "${scanText.slice(0, 200)}". Calls start again tomorrow${first ? ` at ${first}` : ''}.`
        });
        if (rec.alert) await notifyFamily({ parentId: parent.id, callLogId: null, alerts: [rec.alert] }, deps);
      }
      return (await reply(cfg, { id: inbound.id, phone: inbound.phone, userId: null }, PARENT_REPLIES.pausedToday(first), deps, 'reply', parent.id)) ? 1 : 0;
    }

    const symptoms = scanSymptomMessage(scanText);
    if (symptoms.hit) {
      const gapStart = new Date(now.getTime() - PARENT_UNWELL_GAP_HOURS * 3600000);
      const alreadyTold = (await prisma.whatsAppMessage.count({ where: { parentId: parent.id, kind: 'unwell_reply', createdAt: { gte: gapStart } } })) > 0;
      if (!alreadyTold) {
        const rec = await recordAlert({
          parentId: parent.id,
          callLogId: null,
          level: 3,
          title: ALERT_TITLES.health,
          message: `${parent.name} may not be feeling well and wrote to Saathi on WhatsApp: "${scanText.slice(0, 200)}". Please check in with them today.`
        });
        if (rec.alert) await notifyFamily({ parentId: parent.id, callLogId: null, alerts: [rec.alert] }, deps);
      }
      const row = await prisma.whatsAppMessage.create({
        // Only replies that went with an alert start the gap ('unwell_reply'); the others are 'unwell_reply_quiet'.
        data: { id: newId('wam'), userId: null, parentId: parent.id, kind: alreadyTold ? 'unwell_reply_quiet' : 'unwell_reply', refKey: `reply:${inbound.id}`, phone: inbound.phone, body: PARENT_REPLIES.unwell(familyName), createdAt: now }
      });
      try {
        const { messageId } = await sendText(cfg, inbound.phone, PARENT_REPLIES.unwell(familyName), deps.fetchImpl);
        await prisma.whatsAppMessage.update({ where: { id: row.id }, data: { status: 'sent', providerMessageId: messageId } });
        return 1;
      } catch (err) {
        await prisma.whatsAppMessage.update({ where: { id: row.id }, data: { status: 'failed', error: (err instanceof Error ? err.message : 'unknown').slice(0, 300) } });
        return 0;
      }
    }
  }

  const since = new Date(now.getTime() - 86400000);
  const recent = await prisma.whatsAppMessage.count({ where: { phone: inbound.phone, kind: 'scam_reply', createdAt: { gte: since } } });
  if (recent >= MAX_SCAM_CHECKS_PER_DAY) return 0;

  let image: { data: Buffer; mimeType: string } | null = null;
  let caption = text;
  if (type === 'image') {
    const media = obj(msg.image);
    caption = str(media.caption).trim();
    try {
      if (str(media.id)) image = await downloadMedia(cfg, str(media.id), deps.fetchImpl);
    } catch (err) {
      console.error('[whatsapp] Could not download the image to check:', err instanceof Error ? err.message : err);
    }
  }

  const check = await checkForScam(
    { text: caption, image, parentLanguage: parent.language, familyName },
    { client: deps.claude }
  );
  const replyText = check.ok ? check.result.reply : fallbackReply(familyName);
  const sent = await reply(cfg, { id: inbound.id, phone: inbound.phone, userId: null }, replyText, deps, 'scam_reply', parent.id);

  if (check.ok && (check.result.verdict === 'likely_scam' || check.result.verdict === 'suspicious')) {
    const signs = check.result.warning_signs.filter(Boolean).slice(0, 4).join(', ');
    const rec = await recordAlert({
      parentId: parent.id,
      callLogId: null,
      level: 2,
      title: SCAM_ALERT_TITLE,
      message: `${parent.name} forwarded a message to Saathi that ${check.result.verdict === 'likely_scam' ? 'looks like a scam' : 'looks suspicious'}${signs ? ` (${signs})` : ''}. Saathi told them not to pay, click or share any code and to talk to you first. A quick call to reassure them may help.`
    });
    if (rec.alert) await notifyFamily({ parentId: parent.id, callLogId: null, alerts: [rec.alert] }, deps);
  }
  return sent ? 1 : 0;
}

export async function processWhatsAppWebhook(body: unknown, deps: InboundDeps = {}): Promise<InboundSummary> {
  const cfg = deps.whatsapp !== undefined ? deps.whatsapp : getWhatsAppConfig();
  const summary: InboundSummary = { statuses: 0, messages: 0, replies: 0 };
  for (const entry of arr(obj(body).entry)) {
    for (const change of arr(obj(entry).changes)) {
      const value = obj(obj(change).value);
      for (const st of arr(value.statuses)) {
        if (await handleStatus(obj(st), deps)) summary.statuses += 1;
      }
      for (const msg of arr(value.messages)) {
        summary.messages += 1;
        summary.replies += await handleMessage(obj(msg), cfg, deps);
      }
    }
  }
  return summary;
}
