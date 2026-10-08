import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { prisma } from '@/lib/prisma';
import { normalizePhone } from '@/lib/phone';
import { getWhatsAppConfig, getBusinessNumber } from '@/lib/whatsapp';
import { consumeRateLimit } from '@/lib/security';

/** WhatsApp call updates for the logged-in account: status, opt in, opt out. */
async function status(userId: string, accountPhone: string) {
  const prefs = await prisma.notificationPreferences.findUnique({ where: { userId } });
  const business = await getBusinessNumber(getWhatsAppConfig());
  const optedIn = !!prefs?.whatsappOptInAt && prefs.whatsapp !== false;
  return {
    available: !!getWhatsAppConfig(),
    optedIn,
    optedInAt: optedIn ? prefs!.whatsappOptInAt!.toISOString() : null,
    number: prefs?.whatsappNumber || accountPhone || '',
    // Updates only start once this number has sent us START; until then the person is shown the link below.
    verified: optedIn && !!prefs?.whatsappVerifiedAt,
    startLink: optedIn && !prefs?.whatsappVerifiedAt && business ? `https://wa.me/${business}?text=START` : null
  };
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ success: true, whatsapp: await status(auth.user.id, auth.user.phone) });
}

/** Body: { optIn: boolean, number?: string }. Opting in needs a valid number and records when consent was given. */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: { optIn?: unknown; number?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const userId = auth.user.id;

  if (body.optIn !== true) {
    await prisma.notificationPreferences.upsert({
      where: { userId },
      create: { userId, whatsapp: false, whatsappOptInAt: null },
      update: { whatsapp: false, whatsappOptInAt: null }
    });
    return NextResponse.json({ success: true, whatsapp: await status(userId, auth.user.phone) });
  }

  const raw = typeof body.number === 'string' && body.number.trim() ? body.number : auth.user.phone;
  const phone = normalizePhone(raw || '');
  if (!phone.ok) {
    return NextResponse.json({ error: raw ? phone.reason : 'Add your WhatsApp number first.' }, { status: 400 });
  }
  const number = phone.e164 === auth.user.phone ? null : phone.e164;
  // The number isn't proven to be the user's yet (no START-from-that-number step), so cap how many different
  // numbers one account can point updates at: keeps the account from being used to message strangers.
  const current = await prisma.notificationPreferences.findUnique({ where: { userId }, select: { whatsappNumber: true } });
  if ((current?.whatsappNumber ?? null) !== number && !consumeRateLimit(`wa-number:${userId}`, 3, 24 * 60 * 60 * 1000).allowed) {
    return NextResponse.json({ error: 'You have changed your WhatsApp number several times today. Please try again tomorrow.' }, { status: 429 });
  }
  // Messages to foreign numbers cost Meta's (much higher) international rate: people abroad start on
  // "only when something needs attention + one daily summary". They can change it in their settings.
  const abroad = !phone.e164.startsWith('+91');
  const existing = await prisma.notificationPreferences.findUnique({ where: { userId }, select: { whatsappOptInAt: true, whatsappNumber: true, whatsappVerifiedAt: true } });
  // A new number starts unproven; the same number that was already proven stays proven.
  const sameNumber = (existing?.whatsappNumber ?? null) === number;
  const verifiedAt = sameNumber ? existing?.whatsappVerifiedAt ?? null : null;
  const abroadDefaults = abroad && !existing?.whatsappOptInAt ? { minimumAlertLevel: 2, dailySummary: true } : {};
  await prisma.notificationPreferences.upsert({
    where: { userId },
    create: { userId, whatsapp: true, whatsappOptInAt: new Date(), whatsappNumber: number, whatsappVerifiedAt: null, ...abroadDefaults },
    update: { whatsapp: true, whatsappOptInAt: new Date(), whatsappNumber: number, whatsappVerifiedAt: verifiedAt, ...abroadDefaults }
  });
  return NextResponse.json({ success: true, whatsapp: await status(userId, auth.user.phone) });
}
