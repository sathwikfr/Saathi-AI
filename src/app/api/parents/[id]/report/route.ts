import { NextResponse } from 'next/server';
import { requireParentAccess } from '@/lib/access';
import { getMedicinesForParent, getCallLogsForParent, getAlertsForParent, getEmergencyContacts } from '@/lib/db';
import { getInsightsForParent } from '@/lib/insights';

type Ctx = { params: Promise<{ id: string }> };

/** Everything the printable doctor summary needs (last `days`, default 30). */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireParentAccess(id, 'view');
  if (!access.ok) return access.response;
  const days = Math.min(90, Math.max(7, parseInt(new URL(req.url).searchParams.get('days') || '30', 10) || 30));
  const since = Date.now() - days * 86400000;

  const [medicines, callLogs, alerts, insights, contacts] = await Promise.all([
    getMedicinesForParent(id),
    getCallLogsForParent(id),
    getAlertsForParent(id),
    getInsightsForParent(id, days),
    getEmergencyContacts(id)
  ]);
  const inRange = (iso?: string) => !!iso && new Date(iso).getTime() >= since;
  return NextResponse.json({
    parent: access.parent,
    days,
    generatedAt: new Date().toISOString(),
    medicines,
    callLogs: callLogs.filter(c => inRange(c.createdAt)),
    alerts: alerts.filter(a => a.level >= 2 && inRange(a.createdAt)).map(a => ({ ...a, escalation: undefined })),
    insights,
    doctor: { name: access.parent.doctorName || null, phone: access.parent.doctorPhone || null },
    contacts: contacts.map(c => ({ name: c.name, relation: c.relation, phone: c.phone }))
  });
}
