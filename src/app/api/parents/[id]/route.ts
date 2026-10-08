import { NextResponse } from 'next/server';
import {
  updateParent,
  pauseParentCalls,
  deleteParentSoft,
  getMedicinesForParent,
  getEmergencyContacts,
  getCallLogsForParent,
  getAlertsForParent,
  getScheduleSuggestionsForParent,
  getCaregiversForParent,
  getNotificationPreferences,
  updateParentDetails,
  markParentSetupStep,
  setEmergencyCardShared,
  replaceEmergencyContacts,
  setCallTogether,
  ParentUpdates,
  ParentDetailsUpdate
} from '@/lib/db';
import { requireParentAccess } from '@/lib/access';
import { normalizePhone } from '@/lib/phone';
import { getInsightsForParent } from '@/lib/insights';
import { roleAllows } from '@/lib/familyAccess';
import { prisma } from '@/lib/prisma';
import { getEffectivePlan, reminderChannelFor, healthMonitorPrice } from '@/lib/plans';
import { isVitalsSlot } from '@/lib/callDispatch';
import { newId } from '@/lib/db';
import { parseClockTime } from '@/lib/ist';
import { getRemindersForParent } from '@/lib/reminders';
import { getWhatsAppConfig, getBusinessNumber, startLink } from '@/lib/whatsapp';
import { getUserById, newReminderStartCode, setCaretaker } from '@/lib/db';
import { isPremiumParent, premiumRequired, canTrackReadings, ownerHasHealthMonitor, readingsRequired } from '@/lib/planAccess';

type Ctx = { params: Promise<{ id: string }> };

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireParentAccess(id, 'view');
  if (!access.ok) return access.response;

  const [medicines, emergencyContacts, callLogs, alerts, suggestions, caregivers, notifPrefs, insights] = await Promise.all([
    getMedicinesForParent(id),
    getEmergencyContacts(id),
    getCallLogsForParent(id),
    getAlertsForParent(id),
    getScheduleSuggestionsForParent(id),
    getCaregiversForParent(id),
    getNotificationPreferences(access.user.id),
    getInsightsForParent(id)
  ]);

  const isOwner = access.role === 'owner';
  const parent = access.parent;
  const manage = roleAllows(access.role, 'manage');
  const card = manage
    ? await prisma.parentProfile.findUnique({ where: { id }, select: { cardToken: true, reminderStartCode: true, caretakerStartCode: true } })
    : null;
  // How this person's reminders go out follows the OWNER's plan (a viewer's own plan doesn't matter).
  const owner = access.role === 'owner' ? access.user : await getUserById(parent.userId);
  const ownerPlan = getEffectivePlan(owner?.subscription, owner?.createdAt);
  const channel = reminderChannelFor(ownerPlan, parent);
  const waCfg = getWhatsAppConfig();
  const businessNumber = channel === 'whatsapp' && manage ? await getBusinessNumber(waCfg) : null;
  return NextResponse.json({
    parent,
    role: access.role,
    medicines,
    emergencyContacts,
    callLogs,
    alerts,
    suggestions,
    // Members see who else helps, but invite links stay with the owner.
    caregivers: isOwner ? caregivers : caregivers.filter(c => c.status === 'accepted').map(c => ({ ...c, inviteUrl: undefined, email: '' })),
    notifPrefs,
    insights,
    // Other parents on the owner's account with the same phone: can be called together.
    callTogetherCandidates: isOwner
      ? (await prisma.parentProfile.findMany({
          where: { userId: access.user.id, isDeleted: false, id: { not: id }, phone: parent.phone },
          select: { id: true, name: true }
        }))
      : [],
    saathiNumber: process.env.SARVAM_AGENT_PHONE_NUMBER || null,
    supportPhone: process.env.NEXT_PUBLIC_SUPPORT_PHONE || null,
    cardUrl: card?.cardToken ? `${appUrl()}/card/${card.cardToken}` : null,
    channel,
    ownerPlanChannel: ownerPlan.channel,
    // Family / Extended features are shown (or offered as an upgrade) from the owner's plan.
    ownerPlan: {
      id: ownerPlan.id, name: ownerPlan.name, premium: ownerPlan.premium, askPerMonth: ownerPlan.askPerMonth, whatsappPeople: ownerPlan.whatsappPeople,
      healthMonitor: await ownerHasHealthMonitor(parent.userId),
      healthMonitorPrice: healthMonitorPrice(ownerPlan.id)
    },
    // Health Monitor: the time of the short readings call (a call with no tablets), if one is set.
    vitalsCall: (await prisma.scheduledCallSlot.findMany({ where: { parentId: id, isActive: true, slot: 'wellness' } })).find(isVitalsSlot)?.time || null,
    reminders: channel === 'whatsapp' ? await getRemindersForParent(id) : [],
    // The START link is only shown to people who manage this person: whoever sends the code gets the reminders.
    reminderStart: channel === 'whatsapp' && manage
      ? {
          whatsappReady: !!waCfg && !!businessNumber,
          link: businessNumber && card?.reminderStartCode ? startLink(businessNumber, card.reminderStartCode) : null,
          code: card?.reminderStartCode || null,
          // The caretaker's own START link (Remind plan).
          caretakerLink: businessNumber && card?.caretakerStartCode ? startLink(businessNumber, card.caretakerStartCode) : null
        }
      : null
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { action, updates, pauseReason, pauseUntil } = body as {
    action?: string;
    updates?: Record<string, unknown>;
    pauseReason?: string;
    pauseUntil?: string | null;
  };

  // Removing a parent or linking two parents' calls is the owner's call; everything else needs manage access.
  const access = await requireParentAccess(id, action === 'delete' || action === 'call_together' ? 'owner' : 'manage');
  if (!access.ok) return access.response;

  try {
    if (action === 'pause') {
      if (pauseUntil !== undefined && pauseUntil !== null) {
        const until = new Date(pauseUntil);
        if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
          return NextResponse.json({ error: 'Please choose a valid future date to resume calls.' }, { status: 400 });
        }
      }
      const updated = await pauseParentCalls(id, true, pauseReason || 'Travel / Vacation', pauseUntil || undefined);
      return NextResponse.json({ success: true, parent: updated, message: 'Calls paused successfully.' });
    }

    if (action === 'resume') {
      const before = access.parent.parentConsent;
      const updated = await pauseParentCalls(id, false);
      const askAgain = before === 'declined' || before === 'withdrawn';
      return NextResponse.json({
        success: true,
        parent: updated,
        message: askAgain
          ? `Calls resumed. On the next call Saathi will first ask ${access.parent.name} if the calls are okay.`
          : 'Calls resumed successfully.'
      });
    }

    if (action === 'delete') {
      await deleteParentSoft(id);
      return NextResponse.json({ success: true, message: 'Parent profile archived. Calls have stopped; past call logs are kept.' });
    }

    if (action === 'update' && updates && typeof updates === 'object') {
      const allowed: ParentUpdates = {
        name: updates.name as string | undefined,
        relationship: updates.relationship as string | undefined,
        language: updates.language as string | undefined,
        timezone: updates.timezone as string | undefined,
        callTime: updates.callTime as string | undefined
      };
      if (updates.phone !== undefined) {
        const phoneResult = normalizePhone(String(updates.phone));
        if (!phoneResult.ok) {
          return NextResponse.json({ error: phoneResult.reason }, { status: 400 });
        }
        // Saathi only calls numbers in India.
        if (!phoneResult.e164.startsWith('+91')) {
          return NextResponse.json({ error: 'Saathi can only call Indian numbers (+91).' }, { status: 400 });
        }
        allowed.phone = phoneResult.e164;
      }
      const updated = await updateParent(id, allowed);
      return NextResponse.json({ success: true, parent: updated, message: 'Parent settings updated.' });
    }

    // Emergency card, "lives alone", birthday and the weekly companion call.
    if (action === 'details' && updates && typeof updates === 'object') {
      const u = updates as ParentDetailsUpdate;
      // Festivals, special days and the helper check went with the Daily Touches add-on (removed 2026-10-08).
      if (u.festivals?.length || u.specialDays?.length || u.helperName || u.helperDays?.length) {
        return NextResponse.json({ error: 'Festival wishes and the helper check are no longer offered.' }, { status: 410 });
      }
      // BP / sugar: the Health Monitor add-on.
      if ((u.readingsToAsk?.length || u.readingRanges) && !(await canTrackReadings(access.parent.userId))) return readingsRequired();
      const updated = await updateParentDetails(id, updates as ParentDetailsUpdate);
      return NextResponse.json({ success: true, parent: updated, message: 'Saved.' });
    }

    // City for weather notes: went with the Daily Touches add-on (removed 2026-10-08).
    if (action === 'city') {
      return NextResponse.json({ error: 'Weather notes are no longer offered.' }, { status: 410 });
    }

    // One call for both parents on the same phone.
    if (action === 'call_together') {
      if ((body as { partnerId?: unknown }).partnerId && !(await isPremiumParent(access.parent.userId))) {
        return premiumRequired('One call for a couple sharing a phone');
      }
      const partnerId = (body as { partnerId?: unknown }).partnerId;
      const linkTo = typeof partnerId === 'string' && partnerId ? partnerId : null;
      const res = await setCallTogether(id, linkTo);
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
      const bothAgreed = linkTo
        ? (await prisma.parentProfile.count({ where: { id: { in: [id, linkTo] }, parentConsent: 'given' } })) === 2
        : false;
      return NextResponse.json({
        success: true,
        message: !linkTo
          ? 'Saathi will call them separately.'
          : bothAgreed
            ? 'From the next call, Saathi calls them together.'
            : 'Saathi will call them together once both have said yes on their own first call.'
      });
    }

    // Health Monitor: the time of the short readings call, or null to turn it off.
    if (action === 'vitals_call') {
      if (!(await ownerHasHealthMonitor(access.parent.userId))) return readingsRequired();
      const time = (body as { time?: unknown }).time;
      const existing = (await prisma.scheduledCallSlot.findMany({ where: { parentId: id, slot: 'wellness' } })).filter(isVitalsSlot);
      if (time === null) {
        await prisma.scheduledCallSlot.updateMany({ where: { id: { in: existing.map(s => s.id) } }, data: { isActive: false } });
        return NextResponse.json({ success: true, message: 'The readings call is off.' });
      }
      if (typeof time !== 'string' || parseClockTime(time) === null) {
        return NextResponse.json({ error: 'Please choose a time, like 08:00 AM.' }, { status: 400 });
      }
      if (existing.length > 0) {
        await prisma.scheduledCallSlot.update({ where: { id: existing[0].id }, data: { time, isActive: true } });
        await prisma.scheduledCallSlot.updateMany({ where: { id: { in: existing.slice(1).map(s => s.id) } }, data: { isActive: false } });
      } else {
        await prisma.scheduledCallSlot.create({
          data: { id: newId('slot'), parentId: id, time, slot: 'wellness', label: 'Health readings', linkedMedicineNames: [], linkedMedicinesJson: '[]', isActive: true }
        });
      }
      return NextResponse.json({ success: true, message: `Saathi will call at ${time} for the BP and sugar readings.` });
    }

    // WhatsApp reminders: discreet mode (no medicine names on the lock screen).
    if (action === 'reminder_settings') {
      const { discreet, weeklyProgress, weeklyProgressToCaretaker } = body as { discreet?: unknown; weeklyProgress?: unknown; weeklyProgressToCaretaker?: unknown };
      const data: { discreetReminders?: boolean; weeklyProgress?: boolean; weeklyProgressToCaretaker?: boolean } = {};
      for (const [key, value] of [['discreetReminders', discreet], ['weeklyProgress', weeklyProgress], ['weeklyProgressToCaretaker', weeklyProgressToCaretaker]] as const) {
        if (value === undefined) continue;
        if (typeof value !== 'boolean') return NextResponse.json({ error: `${key} must be true or false` }, { status: 400 });
        data[key] = value;
      }
      if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
      await prisma.parentProfile.update({ where: { id }, data });
      const message =
        data.weeklyProgress !== undefined
          ? data.weeklyProgress ? 'Weekly progress is on: one message on Sunday evening.' : 'Weekly progress is off.'
          : data.weeklyProgressToCaretaker !== undefined
            ? data.weeklyProgressToCaretaker ? 'The caretaker gets the weekly progress too.' : 'The weekly progress goes only to the person.'
            : data.discreetReminders ? 'Reminders will not name the medicines.' : 'Reminders will name the medicines.';
      return NextResponse.json({ success: true, message });
    }

    // Remind plan: the caretaker (name + WhatsApp number, any country), or null to remove.
    if (action === 'caretaker') {
      const c = (body as { caretaker?: unknown }).caretaker;
      if (c === null) {
        await setCaretaker(id, null);
        return NextResponse.json({ success: true, message: 'Caretaker removed. Missed doses now only show on the dashboard.' });
      }
      const name = c && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string' ? (c as { name: string }).name.trim().slice(0, 80) : '';
      const phone = normalizePhone(c && typeof c === 'object' ? String((c as { phone?: unknown }).phone || '') : '');
      if (!name) return NextResponse.json({ error: 'Please add the caretaker\'s name.' }, { status: 400 });
      if (!phone.ok) return NextResponse.json({ error: phone.reason }, { status: 400 });
      await setCaretaker(id, { name, phone: phone.e164 });
      return NextResponse.json({ success: true, message: `Saved. ${name} starts getting updates after sending START from their WhatsApp.` });
    }

    if (action === 'new_caretaker_code') {
      const has = await prisma.parentProfile.findUnique({ where: { id }, select: { caretakerPhone: true } });
      if (!has?.caretakerPhone) return NextResponse.json({ error: 'Add a caretaker first.' }, { status: 400 });
      await prisma.parentProfile.update({ where: { id }, data: { caretakerStartCode: newReminderStartCode() } });
      return NextResponse.json({ success: true, message: 'New caretaker link ready. The old one no longer works.' });
    }

    // A new START link (e.g. a new phone). The old code stops working.
    if (action === 'new_start_code') {
      await prisma.parentProfile.update({ where: { id }, data: { reminderStartCode: newReminderStartCode() } });
      return NextResponse.json({ success: true, message: 'New WhatsApp link ready. The old one no longer works.' });
    }

    // Calls or WhatsApp reminders (calling plans only; Remind is always WhatsApp).
    if (action === 'reminder_channel') {
      const channel = (body as { channel?: unknown }).channel;
      if (channel !== 'call' && channel !== 'whatsapp') return NextResponse.json({ error: 'channel must be call or whatsapp' }, { status: 400 });
      const owner = access.role === 'owner' ? access.user : await getUserById(access.parent.userId);
      const ownerPlan = getEffectivePlan(owner?.subscription, owner?.createdAt);
      if (ownerPlan.channel === 'whatsapp' && channel === 'call') {
        return NextResponse.json(
          { error: 'The Remind plan sends WhatsApp medicine checks only. Calls come with Solo, Family and Extended.', code: 'PLAN_WHATSAPP_ONLY' },
          { status: 402 }
        );
      }
      const current = await prisma.parentProfile.findUnique({ where: { id }, select: { reminderStartCode: true } });
      await prisma.parentProfile.update({
        where: { id },
        data: channel === 'whatsapp'
          ? { reminderChannel: 'whatsapp', reminderStartCode: current?.reminderStartCode || newReminderStartCode() }
          : { reminderChannel: null }
      });
      return NextResponse.json({
        success: true,
        message: channel === 'whatsapp'
          ? `Saathi stops calling ${access.parent.name}. WhatsApp reminders start once they send START from their phone.`
          : `Saathi will call ${access.parent.name} at their times from now on; WhatsApp reminders stop.`
      });
    }

    if (action === 'setup_step') {
      const step = (body as { step?: string }).step;
      if (step !== 'introduced' && step !== 'number_saved') {
        return NextResponse.json({ error: 'Unknown step' }, { status: 400 });
      }
      await markParentSetupStep(id, step, (body as { done?: boolean }).done !== false);
      return NextResponse.json({ success: true });
    }

    if (action === 'share_card') {
      const shared = (body as { shared?: boolean }).shared === true;
      const token = await setEmergencyCardShared(id, shared);
      return NextResponse.json({
        success: true,
        cardUrl: token ? `${appUrl()}/card/${token}` : null,
        message: token ? 'Emergency card link created. Anyone with the link can see it.' : 'The old link no longer works.'
      });
    }

    if (action === 'contacts') {
      const list = (body as { contacts?: unknown }).contacts;
      if (!Array.isArray(list) || list.length === 0) {
        return NextResponse.json({ error: 'Please keep at least one emergency contact.' }, { status: 400 });
      }
      if (list.length > 6) return NextResponse.json({ error: 'Up to 6 emergency contacts.' }, { status: 400 });
      const clean = [];
      for (const [i, raw] of list.entries()) {
        const c = (raw || {}) as Record<string, unknown>;
        const name = String(c.name || '').trim().slice(0, 120);
        const norm = normalizePhone(String(c.phone || ''));
        if (!name || !norm.ok) {
          return NextResponse.json({ error: `Contact ${i + 1}: ${!name ? 'name is required' : norm.ok ? '' : norm.reason}` }, { status: 400 });
        }
        clean.push({
          id: typeof c.id === 'string' ? c.id : undefined,
          name,
          relation: String(c.relation || 'Family').slice(0, 100),
          phone: norm.e164,
          role: typeof c.role === 'string' ? c.role : undefined,
          isLocal: c.isLocal === true
        });
      }
      const contacts = await replaceEmergencyContacts(id, clean);
      return NextResponse.json({ success: true, contacts, message: 'Emergency contacts saved.' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    console.error('Update parent error:', err);
    const message = err instanceof Error && err.message.startsWith('Invalid') ? err.message : 'Failed to update parent profile.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireParentAccess(id, 'owner');
  if (!access.ok) return access.response;

  await deleteParentSoft(id);
  return NextResponse.json({ success: true, message: 'Parent profile archived. Calls have stopped; past call logs are kept.' });
}
