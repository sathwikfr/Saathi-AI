'use client';

import React from 'react';
import { PageTransition } from '@/components/motion/PageTransition';
import Link from 'next/link';
import { ArrowLeft, Check, CheckCheck, Eye, EyeOff, MessageCircle, Phone } from 'lucide-react';
import { Brand } from '@/components/Navbar';
import { ThemeToggle } from '@/components/ThemeToggle';
import { PHONE_COUNTRIES } from '@/lib/phone';
import { SaathiBlob } from '@/components/voice/SaathiBlob';
import type { OrbMode } from '@/components/voice/SaathiOrb';
import { CALL_SCRIPT } from '@/components/landing/callScript';

/** No SMS provider yet: phone OTP only works under `next dev` (the API answers 503 elsewhere), so the tab is hidden there. */
export const phoneOtpAvailable = process.env.NODE_ENV === 'development';

type AuthShellProps = {
  children: React.ReactNode;
  /** Optional heading for the side panel; defaults to the brand promise. */
  asideTitle?: React.ReactNode;
  asidePoints?: string[];
};

const DEFAULT_POINTS = ['9 Indian languages', 'No app for your parents', 'Calls or WhatsApp checks'];

/** Split-screen layout used by login, signup and password reset. */
export function AuthShell({ children, asideTitle, asidePoints = DEFAULT_POINTS }: AuthShellProps) {
  return (
    <div className="auth-shell">
      <PageTransition>
      <main id="main" className="auth-main">
        <div className="auth-top">
          <Brand />
          <div className="auth-top-actions">
            <ThemeToggle />
            <Link href="/" className="btn btn-quiet btn-sm">
              <ArrowLeft size={15} /> Home
            </Link>
          </div>
        </div>
        <div className="auth-body animate-fade-in">{children}</div>
      </main>
      </PageTransition>

      <aside className="auth-aside" aria-hidden="true">
        <div>
          <span className="eyebrow auth-aside-eyebrow">Aaptha</span>
          <h2>{asideTitle ?? <>Stay close to your parents, <em>even from far away.</em></>}</h2>
        </div>

        <MorningStory />

        <ul className="auth-points">
          {asidePoints.map((p) => (
            <li key={p}><Check size={16} /> {p}</li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

/**
 * Tomorrow morning, told by the landing's orb: it rings, Saathi and Amma talk (the landing's own example
 * call, CALL_SCRIPT in English) with the orb following who speaks, then the family's WhatsApp update
 * arrives (wording from the real 'aaptha_call_alert' template). Loops. Decorative (the panel is aria-hidden).
 */
type Beat = { mode: OrbMode; ms: number; who: 'ring' | 'saathi' | 'parent' | 'wa'; text: string };

const STORY: Beat[] = [
  { mode: 'ringing', ms: 2600, who: 'ring', text: 'Calling Amma · 8:30 AM' },
  ...CALL_SCRIPT.map((l): Beat => ({
    mode: l.who === 'saathi' ? 'saathi' : 'family',
    ms: l.ms + 900,
    who: l.who === 'saathi' ? 'saathi' : 'parent',
    text: l.text.en,
  })),
  { mode: 'thinking', ms: 1100, who: 'wa', text: '' },
  { mode: 'idle', ms: 4800, who: 'wa', text: 'Amma mentioned not feeling well: “knee pain since yesterday”. Medicines: Amlodipine taken. Mood: calm.' },
];

function MorningStory() {
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    const id = window.setTimeout(() => setI((n) => (n + 1) % STORY.length), STORY[i].ms);
    return () => window.clearTimeout(id);
  }, [i]);
  const b = STORY[i];

  return (
    <div className="auth-story">
      <div className="auth-orb">
        <SaathiBlob mode={b.mode} variant="night" scale={0.5} />
      </div>
      <div className="auth-caption">
        {b.who === 'ring' && (
          <p key={i} className="auth-line" data-who="ring"><span className="auth-ring"><Phone size={14} /></span>{b.text}</p>
        )}
        {(b.who === 'saathi' || b.who === 'parent') && (
          <p key={i} className="auth-line" data-who={b.who}><small>{b.who === 'saathi' ? 'Saathi' : 'Amma'}</small>{b.text}</p>
        )}
        {b.who === 'wa' && b.text && (
          <p key={i} className="auth-line" data-who="wa">
            <small><MessageCircle size={12} /> On your WhatsApp · 8:31 AM</small>
            {b.text}
            <span className="auth-ticks"><CheckCheck size={14} /></span>
          </p>
        )}
        {b.who === 'wa' && !b.text && <p key={i} className="auth-line auth-typing" data-who="wa"><i /><i /><i /></p>}
      </div>
    </div>
  );
}

type PasswordFieldProps = {
  id: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder?: string;
  autoComplete?: string;
};

export function PasswordField({ id, value, onChange, show, onToggle, placeholder, autoComplete = 'current-password' }: PasswordFieldProps) {
  return (
    <div className="input-affix">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required
        style={{ borderRadius: 'var(--r-md) 0 0 var(--r-md)' }}
      />
      <button type="button" onClick={onToggle} aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

type PhoneFieldProps = {
  id: string;
  /** Full number as typed, e.g. "+91 98765 43210" (a bare Indian number is also fine). */
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  /** Fixed +91 prefix and no country picker (the parent's phone: Saathi calls numbers in India). */
  indiaOnly?: boolean;
  /** The number may be left empty (e.g. a family invite's WhatsApp number). */
  optional?: boolean;
};

export function PhoneField({ id, value, onChange, autoFocus, indiaOnly = false, optional = false }: PhoneFieldProps) {
  const [selected, setSelected] = React.useState('IN');

  if (indiaOnly) {
    return (
      <div className="input-affix">
        <span>+91</span>
        <input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="98765 43210"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          required={!optional}
        />
      </div>
    );
  }

  const picked = PHONE_COUNTRIES.find(c => c.code === selected) ?? PHONE_COUNTRIES[0];
  // If the value already carries a country code (pasted, prefilled or typed as +44...), show that country.
  const fromValue = value.startsWith('+')
    ? [...PHONE_COUNTRIES]
        .filter(c => c.dial && value.startsWith(`+${c.dial}`))
        .sort((a, b) => b.dial.length - a.dial.length)[0]
    : undefined;
  const active = picked.dial && value.startsWith(`+${picked.dial}`) ? picked : fromValue ?? picked;
  const prefix = active.dial ? `+${active.dial}` : '';
  const national = prefix && value.startsWith(prefix) ? value.slice(prefix.length).trimStart() : value;

  const emit = (raw: string, dial: string) => {
    if (raw.trim() === '') return onChange('');
    if (raw.trim().startsWith('+') || !dial) return onChange(raw); // they typed the whole international number
    // Indian numbers are sometimes written with a leading 0 (STD prefix); it is not part of the number.
    return onChange(`+${dial}${dial === '91' ? raw.replace(/^\s*0+/, '') : raw}`);
  };

  return (
    <div className="input-affix">
      <select
        aria-label="Country code"
        value={active.code}
        onChange={(e) => {
          const next = PHONE_COUNTRIES.find(c => c.code === e.target.value) ?? PHONE_COUNTRIES[0];
          setSelected(next.code);
          emit(national, next.dial);
        }}
      >
        {PHONE_COUNTRIES.map(c => (
          <option key={c.code} value={c.code}>
            {c.dial ? `${c.name} +${c.dial}` : c.name}
          </option>
        ))}
      </select>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder={active.code === 'IN' ? '98765 43210' : active.dial ? 'Phone number' : '+49 151 2345 6789'}
        value={national}
        onChange={(e) => emit(e.target.value, active.dial)}
        autoFocus={autoFocus}
        required={!optional}
      />
    </div>
  );
}

export function passwordStrength(password: string) {
  if (!password) return { label: '', score: 0, color: 'var(--line-subtle)' };
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  if (score <= 1) return { label: 'Weak', score: 1, color: 'var(--red)' };
  if (score <= 3) return { label: 'Good', score: 2, color: 'var(--gold)' };
  return { label: 'Strong', score: 3, color: 'var(--green)' };
}

export function StrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const s = passwordStrength(password);
  return (
    <div className="strength" aria-live="polite">
      <div className="strength-bars">
        {[1, 2, 3].map((level) => (
          <i key={level} style={{ background: s.score >= level ? s.color : undefined }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', fontWeight: 600, color: s.color }}>
        <span>{s.label}</span>
        {s.score < 3 && <span style={{ color: 'var(--ink-subtle)', fontWeight: 500 }}>Mix letters, numbers & symbols</span>}
      </div>
    </div>
  );
}

export { Modal } from '@/components/ui/Modal';
