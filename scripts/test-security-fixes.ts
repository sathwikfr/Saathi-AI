/**
 * Pure regression checks for the 2026-10-05 and 2026-10-09 security passes (no database, no network):
 *   npx tsx scripts/test-security-fixes.ts
 */
import { scanMessage, scanForEmergency, scanSymptomMessage } from '../src/lib/safety';
import { isLocalDevHeaders } from '../src/lib/devMode';
import { isCrossSiteRequest, hashToken } from '../src/lib/security';
import { looksLikeDeclaredType } from '../src/lib/storage';
import { getEffectivePlan, PAID_GRACE_DAYS } from '../src/lib/plans';
import { vouches, fixedScamReply } from '../src/lib/scamCheck';
import { ladderRounds, MAX_EMERGENCY_CONTACTS } from '../src/lib/escalation';
import { pausedPastToday } from '../src/lib/reminders';

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}`, detail ?? ''); }
}

console.log('\nEmergency words');
check('"no chest pain" is not an emergency', !scanMessage('I have no chest pain').hit);
check('"no problem but chest pain" IS one', scanMessage('no problem but chest pain').hit);
check('"not sure but severe chest pain now" IS one', scanMessage('not sure but severe chest pain now').hit);
check('breathless / chest tightness / heart pain are caught', ['I am breathless', 'chest tightness', 'heart pain'].every(t => scanMessage(t).hit));
check('everyday "I am fine" is not', !scanMessage('I am fine').hit);
check('native-script words are scanned even when the English text is clean',
  scanForEmergency([{ role: 'user', text: 'my stomach is ok', native: 'నాకు గుండె నొప్పి ఉంది' }]).hit);
check('symptom scan still works', scanSymptomMessage('I have a fever').hit);

console.log('\nDev shortcuts only for a direct loopback request');
const prev = process.env.NODE_ENV;
const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = 'development';
check('localhost:3000 direct → allowed', isLocalDevHeaders(new Headers({ host: 'localhost:3000' })));
check('ngrok host → refused', !isLocalDevHeaders(new Headers({ host: 'clock-monologue-scrounger.ngrok-free.dev' })));
check('localhost behind a tunnel (x-forwarded-for) → refused', !isLocalDevHeaders(new Headers({ host: 'localhost:3000', 'x-forwarded-for': '1.2.3.4' })));
check('x-forwarded-host → refused', !isLocalDevHeaders(new Headers({ host: 'localhost:3000', 'x-forwarded-host': 'evil.example' })));
env.NODE_ENV = 'production';
check('production → always refused', !isLocalDevHeaders(new Headers({ host: 'localhost:3000' })));
env.NODE_ENV = prev;

console.log('\nCross-site requests');
check('no Origin (server to server) → allowed', !isCrossSiteRequest(new Headers({ host: 'app.example.com' })));
check('same-site Origin → allowed', !isCrossSiteRequest(new Headers({ host: 'app.example.com', origin: 'https://app.example.com' })));
check('other site → blocked', isCrossSiteRequest(new Headers({ host: 'app.example.com', origin: 'https://evil.example' })));
check('"null" origin → blocked', isCrossSiteRequest(new Headers({ host: 'app.example.com', origin: 'null' })));

console.log('\nTokens and uploads');
check('hashToken is stable and not the token', hashToken('sess_abc') === hashToken('sess_abc') && !hashToken('sess_abc').includes('sess_abc'));
const pdf = new TextEncoder().encode('%PDF-1.7 ...');
const html = new TextEncoder().encode('<html><script>alert(1)</script>');
check('real PDF passes as application/pdf', looksLikeDeclaredType(pdf, 'application/pdf'));
check('HTML pretending to be a PDF is refused', !looksLikeDeclaredType(html, 'application/pdf'));
check('JPEG magic bytes', looksLikeDeclaredType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'));
check('unknown type refused', !looksLikeDeclaredType(pdf, 'text/html'));

console.log('\nPaid plans fail closed');
const dayMs = 86400000;
const nowDate = new Date('2026-11-01T00:00:00Z');
const subOf = (endDaysAgo: number, status = 'active') => ({ planId: 'family' as const, status, currentPeriodEnd: new Date(nowDate.getTime() - endDaysAgo * dayMs).toISOString() });
const createdAt = '2026-01-01T00:00:00Z';
check('paid period still running → Family', getEffectivePlan(subOf(-10), createdAt, nowDate).id === 'family');
check('period ended a day ago (renewal pending) → still Family', getEffectivePlan(subOf(1), createdAt, nowDate).id === 'family');
check(`period ended more than ${PAID_GRACE_DAYS} days ago, no renewal → not Family any more`, getEffectivePlan(subOf(PAID_GRACE_DAYS + 1), createdAt, nowDate).id !== 'family');
check('a lapsed past_due plan is also closed', getEffectivePlan(subOf(PAID_GRACE_DAYS + 1, 'past_due'), createdAt, nowDate).id !== 'family');

// ---- 2026-10-09 audit (run 2)
console.log('\nScam check never vouches');
check('"This message is genuine" counts as vouching', vouches('This message is genuine.'));
check('"The link is safe" counts as vouching', vouches('The link is safe.'));
check('"can\'t be sure it is genuine" does not', !vouches("I can't be sure it is genuine."));
check('fixed Telugu reply for no clear signs (not the model text), names the family', fixedScamReply('no_clear_signs', 'Telugu', 'Ravi').includes('OTP') && fixedScamReply('no_clear_signs', 'Telugu', 'Ravi').includes('Ravi') && /[ఀ-౿]/.test(fixedScamReply('no_clear_signs', 'Telugu', 'Ravi')));
check('every language has both fixed replies with the OTP rule', ['English', 'Hindi', 'Telugu', 'Tamil', 'Kannada', 'Malayalam', 'Bengali', 'Marathi', 'Gujarati']
  .every(l => fixedScamReply('no_clear_signs', l, 'X').includes('OTP') && fixedScamReply('not_a_check', l, 'X').includes('OTP')));

console.log('\nEmergency ladder size');
const manyContacts = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, phone: `+9198765${String(i).padStart(5, '0')}`, isLocal: false, priority: 'secondary', createdAt: new Date(i) }));
const ladderTargets = (kind: 'emergency' | 'wellness_check') => ladderRounds({
  kind, owner: { id: 'o', name: 'O', phone: '+919999999999', wake: true }, parent: { id: 'p', name: 'P', phone: '+918888888888' }, contacts: manyContacts
}).flat().filter(t => t.targetType === 'contact').length;
check(`an emergency ladder phones at most ${MAX_EMERGENCY_CONTACTS} contacts`, ladderTargets('emergency') === MAX_EMERGENCY_CONTACTS);
check(`a wellness check phones at most ${MAX_EMERGENCY_CONTACTS} contacts`, ladderTargets('wellness_check') === MAX_EMERGENCY_CONTACTS);

console.log('\n"Pause today" keeps a longer pause');
const noon = new Date('2026-11-01T06:30:00Z'); // 12:00 IST
check('not paused → pause today applies', !pausedPastToday({ isPaused: false, pauseUntil: null }, noon));
check('paused with no end (family) → kept', pausedPastToday({ isPaused: true, pauseUntil: null }, noon));
check('paused for a week → kept', pausedPastToday({ isPaused: true, pauseUntil: new Date(noon.getTime() + 7 * dayMs) }, noon));
check('paused until later today → replaced by "until tomorrow"', !pausedPastToday({ isPaused: true, pauseUntil: new Date(noon.getTime() + 3600000) }, noon));


console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
