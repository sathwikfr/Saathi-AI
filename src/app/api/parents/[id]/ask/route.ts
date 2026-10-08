import { NextResponse } from 'next/server';
import { requireParentAccess } from '@/lib/access';
import { askAboutParent, AskTurn } from '@/lib/familyAsk';
import { claimAsk, releaseAsk, dayKey, monthKey } from '@/lib/askUsage';
import { isClaudeConfigured } from '@/lib/claude';
import { getUserById } from '@/lib/db';
import { getEffectivePlan } from '@/lib/plans';

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
  // Each question is a paid AI request: a daily allowance per person, plus a monthly allowance per plan shared by the
  // whole family circle (counted against the account owner). Both are stored in the database (lib/askUsage.ts), so
  // they hold across serverless instances. A question the AI could not answer is given back.
  const now = new Date();
  const owner = await getUserById(access.parent.userId);
  const plan = getEffectivePlan(owner?.subscription, owner?.createdAt);
  const monthlyAllowance = plan.expired ? 0 : plan.askPerMonth;
  if (monthlyAllowance <= 0) {
    return NextResponse.json({ error: 'Ask about your parent comes with the Solo, Family and Extended plans.' }, { status: 402 });
  }
  const dKey = dayKey(access.user.id, now);
  const mKey = monthKey(access.parent.userId, now);
  const day = await claimAsk(dKey, QUESTIONS_PER_DAY);
  if (!day.ok) {
    return NextResponse.json({ error: `That's ${QUESTIONS_PER_DAY} questions today. Please try again tomorrow.` }, { status: 429 });
  }
  const month = await claimAsk(mKey, monthlyAllowance);
  if (!month.ok) {
    await releaseAsk(dKey);
    return NextResponse.json({ error: `Your plan includes ${monthlyAllowance} questions a month and they are used up. A bigger plan has more.` }, { status: 429 });
  }

  const history: AskTurn[] = Array.isArray(body.history) ? body.history : [];
  const res = await askAboutParent({ parentId: id, question: body.question, history });
  if (!res.ok) {
    await Promise.all([releaseAsk(dKey), releaseAsk(mKey)]);
    return NextResponse.json({ error: res.error }, { status: res.status });
  }
  return NextResponse.json({ answer: res.answer });
}
