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
  ParentUpdates,
  ParentDetailsUpdate
} from '@/lib/db';
import { requireParentAccess } from '@/lib/access';
import { normalizePhone } from '@/lib/phone';
import { getInsightsForParent } from '@/lib/insights';
import { roleAllows } from '@/lib/familyAccess';
import { prisma } from '@/lib/prisma';

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
  const card = roleAllows(access.role, 'manage')
    ? await prisma.parentProfile.findUnique({ where: { id }, select: { cardToken: true } })
    : null;
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
    saathiNumber: process.env.SARVAM_AGENT_PHONE_NUMBER || null,
    supportPhone: process.env.NEXT_PUBLIC_SUPPORT_PHONE || null,
    cardUrl: card?.cardToken ? `${appUrl()}/card/${card.cardToken}` : null
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

  // Removing a parent is the owner's call; everything else needs manage access.
  const access = await requireParentAccess(id, action === 'delete' ? 'owner' : 'manage');
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
      const updated = await updateParentDetails(id, updates as ParentDetailsUpdate);
      return NextResponse.json({ success: true, parent: updated, message: 'Saved.' });
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
