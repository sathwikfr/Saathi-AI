import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { placeManualCall } from '@/lib/callDispatch';

/**
 * "Call now": the parent's owner or a co-manager asks Saathi to call immediately. Scheduled
 * daily calls are placed by /api/cron/dispatch, not by this route.
 * Manual calls are rate-limited and never retried.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: { parentId?: string; slot?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.parentId) {
    return NextResponse.json({ error: 'parentId is required' }, { status: 400 });
  }

  const result = await placeManualCall({
    parentId: body.parentId,
    requesterId: auth.user.id,
    kind: 'manual',
    slotType: body.slot
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
  return NextResponse.json({ success: true, callLogId: result.callLogId });
}
