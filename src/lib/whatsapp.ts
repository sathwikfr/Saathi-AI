/**
 * WhatsApp Cloud API (Meta) client for family call updates.
 *
 * Inactive until WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are set.
 * Messages we start must use templates approved in Meta's WhatsApp Manager;
 * the exact texts are in docs/whatsapp-setup.md and must match WHATSAPP_TEMPLATES
 * below. Free text is only allowed within 24 h of the family messaging us
 * (button taps and replies), which is all `sendText` is used for.
 */
import crypto from 'crypto';

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
  apiBase: string;
  templateLanguage: string;
  appUrl: string;
}

export const DEFAULT_WHATSAPP_API_VERSION = 'v23.0';

export function getWhatsAppConfig(): WhatsAppConfig | null {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!accessToken || !phoneNumberId) return null;
  return {
    accessToken,
    phoneNumberId,
    apiVersion: process.env.WHATSAPP_API_VERSION?.trim() || DEFAULT_WHATSAPP_API_VERSION,
    apiBase: (process.env.WHATSAPP_API_BASE?.trim() || 'https://graph.facebook.com').replace(/\/$/, ''),
    templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || 'en',
    appUrl: (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
  };
}

/**
 * Quick-reply payloads, in the same order as the template's quick-reply buttons.
 * The webhook reads them back when the family taps a button.
 */
export const WA_PAYLOAD = { ack: 'ack', recall: 'recall' } as const;

/**
 * Must match the templates submitted to Meta (scripts/create-whatsapp-templates.ts, docs/whatsapp-setup.md).
 * The fixed text ties each message to the check-in calls the family scheduled: Meta filed the first,
 * promotional-sounding wording ("Open Aaptha for…", "Tap a button…") under MARKETING, which costs ~7x more
 * and can be capped or dropped per person. Keep new wording transactional.
 */
export const WHATSAPP_TEMPLATES = {
  call_update: {
    name: 'aaptha_call_result',
    body: 'Your scheduled check-in call with {{1}} has ended. Result: {{2}}\n\nThis is an automated update for the care plan you set up on Aaptha.',
    quickReplies: [] as string[]
  },
  attention: {
    name: 'aaptha_call_alert',
    body: 'Your scheduled check-in call with {{1}} needs your attention. Details: {{2}}\n\nThis alert is part of the care plan you set up on Aaptha.',
    quickReplies: [WA_PAYLOAD.ack, WA_PAYLOAD.recall] as string[]
  },
  emergency: {
    name: 'aaptha_call_emergency',
    body: 'Urgent alert from your scheduled check-in call with {{1}}: {{2}}\n\nTheir phone number is {{3}}. Please call them now.',
    quickReplies: [WA_PAYLOAD.ack] as string[]
  },
  /** Everyone else in the family, once someone says "I'm on it" during an urgent alert. */
  handled: {
    name: 'aaptha_alert_handled',
    body: 'Update on the urgent alert from the check-in call with {{1}}: {{2}} is handling it now.\n\nThis update is part of the care plan you set up on Aaptha.',
    quickReplies: [] as string[]
  },
  /** Daily / weekly / monthly summary, at the time the family picked. */
  summary: {
    name: 'aaptha_care_summary',
    body: 'Your {{1}} summary of the check-in calls with {{2}}: {{3}}\n\nThis summary is part of the care plan you set up on Aaptha.',
    quickReplies: [] as string[]
  }
} as const;

export type WhatsAppTemplateKind = keyof typeof WHATSAPP_TEMPLATES;

export class WhatsAppApiError extends Error {
  constructor(message: string, public status: number, public code?: number) {
    super(message);
    this.name = 'WhatsAppApiError';
  }
}

/** "+91 98765 43210" -> "919876543210" (the form Meta uses for `to` and `from`). */
export function waDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

/** Template parameters may not contain newlines, tabs or more than 4 spaces in a row, and may not be empty. */
export function cleanParam(text: string, max = 700): string {
  const flat = text.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const cut = flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
  return cut || '-';
}

/** The template text with its parameters filled in (stored for the admin view and tests). */
export function renderTemplate(kind: WhatsAppTemplateKind, params: string[]): string {
  return WHATSAPP_TEMPLATES[kind].body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? '');
}

export function buildTemplateRequest(kind: WhatsAppTemplateKind, to: string, params: string[], language: string) {
  const tpl = WHATSAPP_TEMPLATES[kind];
  const components: Array<Record<string, unknown>> = [
    { type: 'body', parameters: params.map(text => ({ type: 'text', text: cleanParam(text) })) }
  ];
  tpl.quickReplies.forEach((payload, index) => {
    components.push({ type: 'button', sub_type: 'quick_reply', index: String(index), parameters: [{ type: 'payload', payload }] });
  });
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: waDigits(to),
    type: 'template',
    template: { name: tpl.name, language: { code: language }, components }
  };
}

async function post(cfg: WhatsAppConfig, body: unknown, fetchImpl: typeof fetch = fetch): Promise<{ messageId: string }> {
  const url = `${cfg.apiBase}/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
  } catch (err) {
    throw new WhatsAppApiError(`network error: ${err instanceof Error ? err.message : 'unknown'}`, 0);
  }
  const data = (await res.json().catch(() => ({}))) as {
    messages?: Array<{ id?: string }>;
    error?: { message?: string; code?: number; error_data?: { details?: string } };
  };
  if (!res.ok || !data.messages?.[0]?.id) {
    const e = data.error;
    const detail = e?.error_data?.details ? ` (${e.error_data.details})` : '';
    throw new WhatsAppApiError(`${e?.message || `HTTP ${res.status}`}${detail}`.slice(0, 300), res.status, e?.code);
  }
  return { messageId: data.messages[0].id };
}

export function sendTemplate(
  cfg: WhatsAppConfig,
  to: string,
  kind: WhatsAppTemplateKind,
  params: string[],
  fetchImpl?: typeof fetch
): Promise<{ messageId: string }> {
  return post(cfg, buildTemplateRequest(kind, to, params, cfg.templateLanguage), fetchImpl);
}

/** Free-text reply; only works within 24 h of the family's last message to us. */
export function sendText(cfg: WhatsAppConfig, to: string, text: string, fetchImpl?: typeof fetch): Promise<{ messageId: string }> {
  return post(
    cfg,
    { messaging_product: 'whatsapp', recipient_type: 'individual', to: waDigits(to), type: 'text', text: { body: text.slice(0, 4000), preview_url: false } },
    fetchImpl
  );
}

export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

/**
 * Downloads an image someone sent us (e.g. a parent forwarding a suspicious SMS screenshot).
 * Two steps, both with the access token: the media id gives a short-lived URL, the URL gives the bytes.
 */
export async function downloadMedia(
  cfg: WhatsAppConfig,
  mediaId: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ data: Buffer; mimeType: string }> {
  const meta = await fetchImpl(`${cfg.apiBase}/${cfg.apiVersion}/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${cfg.accessToken}` },
    signal: AbortSignal.timeout(15000)
  });
  const info = (await meta.json().catch(() => ({}))) as { url?: string; mime_type?: string; file_size?: number };
  if (!meta.ok || !info.url) throw new WhatsAppApiError(`media lookup failed (HTTP ${meta.status})`, meta.status);
  if (info.file_size && info.file_size > MAX_MEDIA_BYTES) throw new WhatsAppApiError('media too large', 413);
  const file = await fetchImpl(info.url, { headers: { Authorization: `Bearer ${cfg.accessToken}` }, signal: AbortSignal.timeout(20000) });
  if (!file.ok) throw new WhatsAppApiError(`media download failed (HTTP ${file.status})`, file.status);
  const data = Buffer.from(await file.arrayBuffer());
  if (data.length > MAX_MEDIA_BYTES) throw new WhatsAppApiError('media too large', 413);
  return { data, mimeType: (info.mime_type || file.headers.get('content-type') || '').split(';')[0].trim() };
}

/** Meta signs webhook bodies with the app secret: `X-Hub-Signature-256: sha256=<hex>`. */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string | undefined): boolean {
  if (!header || !appSecret || !header.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  const given = header.slice(7);
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
