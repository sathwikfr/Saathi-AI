import { NextResponse } from 'next/server';
import { updateScheduleSuggestionStatus } from '@/lib/db';
import { requireParentAccess } from '@/lib/access';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireParentAccess(id, 'manage');
  if (!access.ok) return access.response;

  const { suggestionId, action } = await req.json();

  if (!suggestionId || (action !== 'accepted' && action !== 'dismissed')) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
  }

  const res = await updateScheduleSuggestionStatus(id, suggestionId, action);
  if (!res.success) {
    return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    message: action === 'accepted'
      ? `Call time updated to ${res.updatedCallTime}.`
      : 'Suggestion dismissed. We will continue monitoring pickup patterns.',
    updatedCallTime: res.updatedCallTime
  });
}
