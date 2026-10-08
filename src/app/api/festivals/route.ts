import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/access';
import { getHolidays, upcomingFestivalNames } from '@/lib/festivals';

/** Festivals in the next year (public Indian holiday calendar), for the "what do they celebrate?" picker. */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const list = await getHolidays();
  const now = new Date();
  const names = upcomingFestivalNames(list, now);
  const next = (name: string) => list.find(h => h.name === name && h.date >= now.toISOString().slice(0, 10))?.date || null;
  return NextResponse.json({ festivals: names.map(name => ({ name, nextDate: next(name) })), available: list.length > 0 });
}
