import { NextResponse } from 'next/server';
import { requireParentAccess } from '@/lib/access';
import { askAboutParent, AskTurn } from '@/lib/familyAsk';
import { consumeRateLimit } from '@/lib/security';
import { isClaudeConfigured } from '@/lib/claude';

type Ctx = { params: Promise<{ id: string }> };

const QUESTIONS_PER_DAY = 20;

/** "Ask about Amma": answers only from the parent's own records. Anyone in the family circle. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const access = await requireParentAccess(id, 'view');
  if (!access.ok) return access.response;
  if (!isClaudeConfigured()) {
    return NextResponse.json({ error: 'Ask about your parent is not switched on yet.' }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.question !== 'string' || !body.question.trim()) {
    return NextResponse.json({ error: 'Please type a question.' }, { status: 400 });
  }
  // Each question is a paid AI request: a daily allowance per person.
  const limit = consumeRateLimit(`ask:${access.user.id}`, QUESTIONS_PER_DAY, 24 * 3600 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: `That's ${QUESTIONS_PER_DAY} questions today. Please try again tomorrow.` }, { status: 429 });
  }

  const history: AskTurn[] = Array.isArray(body.history) ? body.history : [];
  const res = await askAboutParent({ parentId: id, question: body.question, history });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ answer: res.answer });
}
