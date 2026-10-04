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
import { recordAlert } from './alerts';
import { notifyFamily } from './familyNotify';
import { WA_REPLIES } from './familyMessages';
import { claimAndEmailFallback, NotifyDeps } from './familyNotify';
import { placeManualCall, DispatchDeps } from './callDispatch';
import { escalationForAlert, markHandled } from './escalation';

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

/** The account a WhatsApp number belongs to: its WhatsApp setting first, then the account phone. */
async function findUserByPhone(e164: string) {
  const pref = await prisma.notificationPreferences.findFirst({ where: { whatsappNumber: e164 }, select: { userId: true } });
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

async function handleMessage(msg: Obj, cfg: WhatsAppConfig | null, deps: InboundDeps): Promise<number> {
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

  // Meta re-delivers messages; the cheap check keeps the unique index (the backstop) out of the error log.
  if (await prisma.whatsAppMessage.findUnique({ where: { providerMessageId: waId }, select: { id: true } })) return 0;
  const user = await findUserByPhone(phone);
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
  if (!user) {
    // A parent forwarding a message they're unsure about: the scam check.
    const parent = await prisma.parentProfile.findFirst({
      where: { phone, isDeleted: false },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' }
    });
    // Numbers we don't know get no reply (keeps the number from answering spam).
    if (!parent) return 0;
    await prisma.whatsAppMessage.update({ where: { id: inbound.id }, data: { parentId: parent.id } });
    return handleParentMessage(msg, type, text, parent, { id: inbound.id, phone }, cfg, deps);
  }
  const target = { id: inbound.id, phone, userId: user.id };

  // ---- button taps: act on the message the button belongs to
  if (payload === WA_PAYLOAD.ack || payload === WA_PAYLOAD.recall) {
    const contextId = str(obj(msg.context).id);
    const original = contextId ? await prisma.whatsAppMessage.findUnique({ where: { providerMessageId: contextId } }) : null;
    if (!original || original.direction !== 'out' || original.phone !== phone) return 0;

    if (payload === WA_PAYLOAD.ack) {
      if (!original.alertId) return 0;
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
  const word = text.toLowerCase().replace(/[.!]+$/, '').trim();
  if (STOP_WORDS.has(word)) {
    await prisma.notificationPreferences.upsert({
      where: { userId: user.id },
      create: { userId: user.id, whatsapp: false, whatsappOptInAt: null },
      update: { whatsapp: false, whatsappOptInAt: null }
    });
    return (await reply(cfg, target, WA_REPLIES.stopped, deps)) ? 1 : 0;
  }
  if (START_WORDS.has(word)) {
    const now = deps.now || new Date();
    const number = user.phone === phone ? null : phone;
    await prisma.notificationPreferences.upsert({
      where: { userId: user.id },
      create: { userId: user.id, whatsapp: true, whatsappOptInAt: now, whatsappNumber: number },
      update: { whatsapp: true, whatsappOptInAt: now, whatsappNumber: number }
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
  parent: { id: string; name: string; language: string; user: { id: string; name: string } },
  inbound: { id: string; phone: string },
  cfg: WhatsAppConfig | null,
  deps: InboundDeps
): Promise<number> {
  if (!cfg) return 0;
  const since = new Date((deps.now || new Date()).getTime() - 86400000);
  const recent = await prisma.whatsAppMessage.count({ where: { phone: inbound.phone, kind: 'scam_reply', createdAt: { gte: since } } });
  if (recent >= MAX_SCAM_CHECKS_PER_DAY) return 0;

  const familyName = parent.user.name.split(' ')[0] || 'your family';
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
