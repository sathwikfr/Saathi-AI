/**
 * India Standard Time helpers. IST is a fixed UTC+05:30 (no daylight saving),
 * and all parent call times in Aaptha are expressed in IST.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The IST wall-clock view of an instant (read it with the getUTC* methods). */
function istShift(date: Date): Date {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

/** IST calendar date as YYYY-MM-DD. */
export function istDateString(date: Date): string {
  return istShift(date).toISOString().slice(0, 10);
}

/** Last day (IST YYYY-MM-DD) of a course of `days` days starting today: 1 day = today. */
export function istLastDayOfCourse(days: number, now: Date = new Date()): string {
  return istDateString(new Date(now.getTime() + (Math.max(1, Math.round(days)) - 1) * 864e5));
}

/** Minutes since midnight in IST (0–1439). */
export function istMinutesOfDay(date: Date): number {
  const d = istShift(date);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Parses "08:30 AM" / "8:30 pm" into minutes since midnight, or null if invalid. */
export function parseClockTime(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 1 || hours > 12 || minutes > 59) return null;
  const period = match[3].toUpperCase();
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

/**
 * Whether a call slot is due now: its time has passed today, but not by more
 * than `windowMinutes` (so an outage never causes a 9 AM call at 6 PM).
 */
export function isSlotDue(slotTime: string, now: Date, windowMinutes: number): boolean {
  const slotMinutes = parseClockTime(slotTime);
  if (slotMinutes === null) return false;
  const elapsed = istMinutesOfDay(now) - slotMinutes;
  return elapsed >= 0 && elapsed <= windowMinutes;
}

/** "08:30 AM" style IST wall-clock time for display. */
export function formatIstClock(date: Date): string {
  const minutes = istMinutesOfDay(date);
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
}
