import { NextResponse } from 'next/server';
import { requireParentAccess } from '@/lib/access';
import { placeManualCall } from '@/lib/callDispatch';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Places a real one-time Saathi call to the parent so the family can hear how
 * it sounds. When calling isn't configured this says so plainly (503) and
 * never fabricates a call log.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireParentAccess(id, 'manage');
  if (!access.ok) return access.response;

  const result = await placeManualCall({ parentId: id, requesterId: access.user.id, kind: 'test' });

  if (!result.ok) {
    return NextResponse.json(
      { success: false, code: result.code, message: result.error, error: result.error },
      { status: result.status }
    );
  }

  return NextResponse.json({
    success: true,
    callLogId: result.callLogId,
    message: `Test call placed. ${access.parent.name}'s phone (${access.parent.phone}) should ring in a moment. The result will appear in Call History.`
  });
}
