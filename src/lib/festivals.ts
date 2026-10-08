/**
 * Festivals and personal special days. The dates come from Google's public "Holidays in India"
 * calendar (all religions, kept up to date, including moving dates like Diwali and Eid). The
 * family ticks the festivals their parent celebrates; Saathi only greets for those, so nobody
 * is wished for a festival that isn't theirs. Families can also add their own days (an
 * anniversary, a weekly fast).
 */
export const HOLIDAY_FEED =
  'https://calendar.google.com/calendar/ical/en.indian%23holiday%40group.v.calendar.google.com/public/basic.ics';

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
}

export interface SpecialDay {
  date: string; // MM-DD (every year) or YYYY-MM-DD (once)
  label: string;
  kind: 'greet' | 'fast';
}

declare global {
  // eslint-disable-next-line no-var
  var __carecircle_holidays: { at: number; list: Holiday[] } | undefined;
}
const CACHE_MS = 12 * 3600000;

/** Parses the iCal feed (unfolds wrapped lines). Pure. */
export function parseHolidayFeed(ics: string): Holiday[] {
  const text = ics.replace(/\r?\n[ \t]/g, '');
  const out: Holiday[] = [];
  for (const block of text.split('BEGIN:VEVENT').slice(1)) {
    const d = block.match(/DTSTART;VALUE=DATE:(\d{4})(\d{2})(\d{2})/);
    const s = block.match(/\nSUMMARY:([^\r\n]+)/);
    if (d && s) out.push({ date: `${d[1]}-${d[2]}-${d[3]}`, name: s[1].replace(/\\,/g, ',').trim() });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function getHolidays(fetchImpl: typeof fetch = fetch): Promise<Holiday[]> {
  const hit = global.__carecircle_holidays;
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list;
  try {
    const res = await fetchImpl(HOLIDAY_FEED, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = parseHolidayFeed(await res.text());
    global.__carecircle_holidays = { at: Date.now(), list };
    return list;
  } catch {
    // Keep the last good list if there was one; otherwise no festivals today.
    return hit?.list || [];
  }
}

/** Festival names coming up in the next year, for the family's picker. */
export function upcomingFestivalNames(list: Holiday[], now: Date): string[] {
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 370 * 86400000).toISOString().slice(0, 10);
  return [...new Set(list.filter(h => h.date >= from && h.date <= to).map(h => h.name))];
}

export function parseSpecialDays(json: string | null | undefined): SpecialDay[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(d => d && typeof d.label === 'string' && typeof d.date === 'string' && /^(\d{4}-)?\d{2}-\d{2}$/.test(d.date))
      .map(d => ({ date: d.date, label: d.label.slice(0, 60), kind: d.kind === 'fast' ? 'fast' : 'greet' }));
  } catch {
    return [];
  }
}

/**
 * What today is for this parent (IST): their birthday, a festival they celebrate, or a day the
 * family added. Returns the `special_day` text for Saathi, e.g. "Diwali" or "fasting day (Ekadashi)".
 */
export function specialDayFor(
  input: { birthDate: string | null; festivals: string[]; specialDays: SpecialDay[]; holidays: Holiday[] },
  now: Date
): string | null {
  const ist = new Date(now.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
  const md = ist.slice(5);
  if (input.birthDate && input.birthDate === md) return 'birthday';
  const own = input.specialDays.find(d => d.date === md || d.date === ist);
  if (own) return own.kind === 'fast' ? `fasting day (${own.label})` : own.label;
  const chosen = new Set(input.festivals.map(f => f.toLowerCase()));
  const fest = input.holidays.find(h => h.date === ist && chosen.has(h.name.toLowerCase()));
  return fest ? fest.name : null;
}
