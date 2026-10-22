/**
 * Builds docs/telugu-review.md: every Telugu line a parent reads or that Saathi listens for, next to the English,
 * filled in with sample names and times, for a native speaker to tick or correct (launch plan, Phase 2).
 * Read-only: no database, no network. Re-run after any wording change:
 *
 *   npx tsx scripts/telugu-review.ts
 */
import fs from 'fs';
import path from 'path';
import { PHRASES, localReplies, appointmentWords, ENGLISH_APPOINTMENT_WORDS } from '../src/lib/waTranslations';
import { REMINDER_REPLIES, MAX_ASKS, weeklyProgressText } from '../src/lib/reminders';
import { WHATSAPP_TEMPLATES } from '../src/lib/whatsapp';
import { NOTICES, introScript } from '../src/lib/parentNotices';
import { fixedScamReply } from '../src/lib/scamCheck';
import { EMERGENCY_TERMS } from '../src/lib/safety';
import { CALL_SCRIPT } from '../src/components/landing/callScript';

const ROOT = path.join(__dirname, '..');
const TELUGU = /[ఀ-౿]/;
const te = PHRASES.te;
const local = localReplies('te', MAX_ASKS);

// Sample values, the same on both sides
const NAME = 'Lakshmi Devi';
const CARE = 'Ravi Kumar';
const TIMES = ['08:00 AM', '08:00 PM'];
const AT = '08:30 AM';
const LOW = [{ name: 'BP tablet', left: 5, days: 3 }];
const OUT = [{ name: 'BP tablet', left: 0, days: 0 }];

let n = 0;
const out: string[] = [];
const item = (what: string, en: string, tel: string) => {
  n++;
  out.push(`**${n}. ${what}**`, '', `- English: ${en.replace(/\n+/g, ' / ')}`, `- Telugu: ${tel.replace(/\n+/g, ' / ')}`, '- [ ] Correct as it is', '- Correction:', '');
};
const section = (title: string, intro: string) => out.push(`## ${title}`, '', intro, '');

/** Words from a list in the source: lines under a "// Telugu" comment, plus any line with Telugu script on it. */
function teluguWords(file: string, listName: string): string[] {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const start = src.search(new RegExp(`const ${listName}[^=]*= \\[`));
  const body = src.slice(start, src.indexOf('];', start));
  const words: string[] = [];
  let underTelugu = false;
  for (const line of body.split('\n')) {
    const comment = line.trim().startsWith('//');
    if (comment) { underTelugu = /^\/\/\s*Telugu\s*$/.test(line.trim()); continue; }
    if (underTelugu || TELUGU.test(line)) words.push(...[...line.matchAll(/'([^']+)'/g)].map(m => m[1]));
  }
  return words;
}

const fillTpl = (body: string, params: string[]) => body.replace(/\{\{(\d+)\}\}/g, (_, i) => params[Number(i) - 1] ?? '');

// ---- 1. WhatsApp messages ---------------------------------------------------
section('1. WhatsApp messages the parent reads (Remind plan)',
  'These go to the parent\'s own WhatsApp. Buttons can be at most 25 characters.');
item('Medicine check (asked at each medicine time)',
  fillTpl(WHATSAPP_TEMPLATES.reminder.body, ['Lakshmi', '8:00 AM', 'BP tablet, Sugar tablet']),
  fillTpl(te.tplReminder, ['Lakshmi', '8:00 AM', 'BP tablet, Sugar tablet']));
item('Button: yes', 'Yes, taken', te.tplYes);
item('Button: not yet', 'Not yet', te.tplNotYet);
item('Check-up reminder',
  fillTpl(WHATSAPP_TEMPLATES.appointment.body, ['Lakshmi', `${ENGLISH_APPOINTMENT_WORDS.tomorrow} 10 AM: ${ENGLISH_APPOINTMENT_WORDS.join('Blood test', 'Apollo Clinic')}.${ENGLISH_APPOINTMENT_WORDS.fasting}`]),
  fillTpl(te.tplAppointment, ['Lakshmi', `${appointmentWords('te').tomorrow} 10 AM: ${appointmentWords('te').join('Blood test', 'Apollo Clinic')}.${appointmentWords('te').fasting}`]));
item('Weekly progress (all taken)', fillTpl(WHATSAPP_TEMPLATES.weekly.body, ['Lakshmi', weeklyProgressText(14, 14)]),
  fillTpl(te.tplWeekly, ['Lakshmi', weeklyProgressText(14, 14, 'te')]));
item('Weekly progress (most taken)', weeklyProgressText(12, 14), weeklyProgressText(12, 14, 'te'));
item('Weekly progress (few taken)', weeklyProgressText(6, 14), weeklyProgressText(6, 14, 'te'));

item('Reply after setting up (with a caretaker)', REMINDER_REPLIES.started(NAME, TIMES, CARE), local.started(NAME, TIMES, CARE));
item('Reply after setting up (no caretaker)', REMINDER_REPLIES.started(NAME, TIMES, null), local.started(NAME, TIMES, null));
item('Checks turned back on', REMINDER_REPLIES.restarted, local.restarted);
item('Checks stopped', REMINDER_REPLIES.stopped, local.stopped);
item('After "Yes, taken"', REMINDER_REPLIES.taken('8:30 AM'), local.taken(AT));
item('Last dose of a course', REMINDER_REPLIES.courseDone, local.courseDone);
item('After "Not yet"', REMINDER_REPLIES.notYet('9:00 AM'), local.notYet('09:00 AM'));
item('After the last "Not yet" (with a caretaker)', REMINDER_REPLIES.notYetLast('9:30 AM', CARE), local.notYetLast('09:30 AM', CARE));
item('"Pause today"', REMINDER_REPLIES.pausedToday('08:00 AM'), local.pausedToday('08:00 AM'));
item('Already marked taken', REMINDER_REPLIES.alreadyTaken, local.alreadyTaken);
item('Tablets running low', REMINDER_REPLIES.runningLow(LOW), local.runningLow(LOW));
item('Tablets run out', REMINDER_REPLIES.runningLow(OUT), local.runningLow(OUT));
item('After telling us the new count', REMINDER_REPLIES.toppedUp('BP tablet', 30), local.toppedUp('BP tablet', 30));
item('Warning words (possible emergency)', REMINDER_REPLIES.emergency(NAME, CARE), local.emergency(NAME, CARE));
item('Not feeling well', REMINDER_REPLIES.unwell(CARE), local.unwell(CARE));

// ---- 2. Parent notice -------------------------------------------------------
section('2. "About Saathi" notice and the intro the child reads out',
  'The notice is the page /notice/te that the family shows or sends the parent. The intro is what the child says to the parent before the first call.');
item('Notice title', NOTICES.en.title, NOTICES.te.title);
NOTICES.en.lines.forEach((line, i) => item(`Notice, point ${i + 1}`, line, NOTICES.te.lines[i] ?? '(missing)'));
item('Notice, support line', NOTICES.en.support('+91 98765 43210'), NOTICES.te.support('+91 98765 43210'));
const introVars = { parentName: 'Amma', time: '08:00 AM', familyName: 'Ravi' };
item('Intro the child reads to the parent', introScript('en', introVars), introScript('te', introVars));

// ---- 3. Scam check ----------------------------------------------------------
section('3. Scam-check replies',
  'When the parent forwards a suspicious message, these fixed replies are used when there is no clear warning. Warnings themselves are written by the AI at the time.');
item('No clear warning signs', fixedScamReply('no_clear_signs', 'English', 'Ravi'), fixedScamReply('no_clear_signs', 'Telugu', 'Ravi'));
item('Not something to check', fixedScamReply('not_a_check', 'English', 'Ravi'), fixedScamReply('not_a_check', 'Telugu', 'Ravi'));

// ---- 4. Landing page --------------------------------------------------------
section('4. Landing page sample call (website visitors see this)', 'Shown on the home page when Telugu is picked.');
for (const line of CALL_SCRIPT) item(line.who === 'saathi' ? 'Saathi says' : 'Amma replies', line.text.en, line.text.te);

// ---- 5. Words Saathi listens for ---------------------------------------------
out.push('## 5. Words Saathi listens for', '',
  'These are not shown to anyone: when a parent says or types one of them, Saathi acts on it. A missing word means a missed',
  'emergency or a missed answer, so please **add** everyday ways to say each thing, in Telugu script **and** the way people',
  'type it in English letters on WhatsApp (e.g. "avunu"). Cross out anything wrong.', '');
const wordList = (title: string, what: string, words: string[]) => {
  out.push(`### ${title}`, '', what, '', words.map(w => `\`${w}\``).join(' · '), '', '- Wrong ones:', '- Missing ones:', '');
};
wordList('Emergency (raises an urgent alert and phones the family)', 'Chest pain, can\'t breathe, fell down, fainted, heart attack, ambulance, help.', EMERGENCY_TERMS.telugu);
wordList('Feeling unwell (family told the same day)', 'Fever, headache, dizziness, vomiting, cough, weakness, "not feeling well".', teluguWords('src/lib/safety.ts', 'SYMPTOMS_OTHER'));
wordList('"Yes, I took it" typed on WhatsApp', 'Counts like tapping the Yes button.', teluguWords('src/lib/reminders.ts', 'YES_ANSWERS'));
wordList('"Not yet" typed on WhatsApp', 'Counts like tapping Not yet.', teluguWords('src/lib/reminders.ts', 'NOT_YET_ANSWERS'));
wordList('"No checks today"', 'Pauses the checks until tomorrow.', teluguWords('src/lib/reminders.ts', 'PAUSE_TODAY'));

const head = [
  '# Telugu review sheet',
  '',
  `Generated by \`npx tsx scripts/telugu-review.ts\` on ${new Date().toISOString().slice(0, 10)} from the code itself. ${n} messages + 5 word lists.`,
  '',
  '**For the reviewer.** These are written for elderly parents, so please check that each line is:',
  '',
  '1. **Natural, everyday spoken Telugu**, the way a respectful younger relative talks, not bookish or "translated".',
  '2. **Respectful** (మీరు form) and **not gendered** where possible (the parent may be a man or a woman).',
  '3. **Correct in meaning** compared with the English.',
  '',
  'Keep these exactly as they are: STOP, START, OTP, PIN, 108, 112, Aaptha, Saathi, times, numbers and names.',
  'Tick "Correct as it is", or write the better Telugu after "Correction". Send the file back; nothing goes live until it is checked.',
  ''
];

const file = path.join(ROOT, 'docs', 'telugu-review.md');
fs.writeFileSync(file, [...head, ...out].join('\n'));
console.log(`Wrote ${path.relative(ROOT, file)}: ${n} messages, 5 word lists.`);
process.exit(0);
