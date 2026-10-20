'use client';

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { PageTransition } from '@/components/motion/PageTransition';
import Link from 'next/link';
import { Check, X } from 'lucide-react';
import { Brand } from '@/components/Navbar';
import { ThemeToggle } from '@/components/ThemeToggle';
import { FoodRelation, MedicineTimingSlot } from '@/lib/types';
import { istLastDayOfCourse } from '@/lib/ist';

const STEPS = ['Parent', 'Medicines', 'Call times', 'Emergency plan', 'Consent'];
/** Remind (WhatsApp reminders): no call times, no emergency plan. */
export const WHATSAPP_STEPS = ['Who', 'Medicines', 'Reminder times', 'Start'];

/** Focused full-page frame for the onboarding wizard. */
export function WizardShell({ step, steps = STEPS, children }: { step: number; steps?: string[]; children: React.ReactNode }) {
  const pct = Math.min(100, ((step - 1) / steps.length) * 100 + (step > steps.length ? 0 : 100 / steps.length / 2));
  // Which way the last step change went: forward slides in from the right, back from the left.
  const [last, setLast] = useState(step);
  const [dir, setDir] = useState(1);
  if (last !== step) {
    setDir(step > last ? 1 : -1);
    setLast(step);
  }
  return (
    <>
      <header className="wizard-top">
        <div className="wrap wizard-top-inner">
          <Brand href="/dashboard" />
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <ThemeToggle />
            <Link href="/dashboard" className="btn btn-quiet btn-sm">
              <X size={16} /> Exit setup
            </Link>
          </div>
        </div>
        <div className="wizard-progress" aria-hidden="true">
          <i style={{ width: `${step > steps.length ? 100 : pct}%` }} />
        </div>
      </header>
      <PageTransition>
      <main id="main" className="wrap" style={{ paddingBottom: '80px', flex: 1 }}>
        {step <= steps.length && (
          <ol className="wizard-steps" aria-label="Setup progress" style={{ listStyle: 'none' }}>
            {steps.map((label, i) => {
              const n = i + 1;
              const state = n < step ? 'done' : n === step ? 'current' : '';
              return (
                <li key={label} className={`wizard-step ${state}`} aria-current={n === step ? 'step' : undefined}>
                  <b>{n < step ? <Check size={13} strokeWidth={3} /> : n}</b>
                  <span>{label}</span>
                </li>
              );
            })}
          </ol>
        )}
        {/* Each step slides in from the side you are heading to (Motion: steps are state, not navigations). */}
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={step}
            className="wizard-panel"
            custom={dir}
            variants={{
              in: (d: number) => ({ opacity: 0, x: 36 * d, filter: 'blur(3px)' }),
              on: { opacity: 1, x: 0, filter: 'blur(0px)' },
              out: (d: number) => ({ opacity: 0, x: -36 * d, filter: 'blur(3px)' }),
            }}
            initial="in"
            animate="on"
            exit="out"
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
      </PageTransition>
    </>
  );
}

export function StepHeader({ eyebrow, title, children }: { eyebrow: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="step-head">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </div>
  );
}

const SLOT_OPTIONS: { slot: MedicineTimingSlot; label: string }[] = [
  { slot: 'morning', label: 'Morning' },
  { slot: 'afternoon', label: 'Afternoon' },
  { slot: 'evening', label: 'Evening' },
  { slot: 'bedtime', label: 'Bedtime' },
  { slot: 'as_needed', label: 'As needed' },
];

/** Multi-select of the times of day a medicine is taken. */
export function SlotPicker({ isSelected, onToggle }: { isSelected: (s: MedicineTimingSlot) => boolean; onToggle: (s: MedicineTimingSlot) => void }) {
  return (
    <div className="pill-group" role="group" aria-label="When is it taken?">
      {SLOT_OPTIONS.map((o) => {
        const on = isSelected(o.slot);
        return (
          <button
            key={o.slot}
            type="button"
            className={`pill-toggle${o.slot === 'as_needed' ? ' warn' : ''}`}
            aria-pressed={on}
            onClick={() => onToggle(o.slot)}
          >
            {on && <Check size={12} strokeWidth={3} />} {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Everyday names a parent knows tablets by, so nobody has to share a prescription or a drug name. No digits: "Iron 30" is a WhatsApp refill reply. */
const NAME_CHIPS = [
  'BP tablet', 'Sugar tablet', 'Thyroid tablet', 'Heart tablet', 'Cholesterol tablet', 'Gas tablet', 'Acidity tablet',
  'Pain tablet', 'Vitamin', 'Calcium', 'Morning tablets', 'Night tablets'
];
/** Shown after "More names". */
const MORE_NAME_CHIPS = [
  'Afternoon tablets', 'Fever tablet', 'Antibiotic tablet', 'Blood thinner', 'Iron tablet', 'Sleep tablet',
  'Allergy tablet', 'Constipation tablet', 'Uric acid tablet', 'Prostate tablet', 'Kidney tablet', 'Syrup', 'Ointment',
  'Eye drops', 'Inhaler', 'Insulin'
];

const DOSE_CHIPS = ['1 tablet', '2 tablets', 'Half tablet', '1 spoon', '2 drops', '1 puff'];

/** One tap fills a text field with a common answer; `more` waits behind a "More" button. */
function QuickChips({ options, more = [], label, value, onPick }: { options: string[]; more?: string[]; label: string; value: string; onPick: (v: string) => void }) {
  const picked = (n: string) => value.trim().toLowerCase() === n.toLowerCase();
  const [open, setOpen] = useState(() => more.some(picked));
  return (
    <div className="pill-group" role="group" aria-label={label} style={{ marginTop: '8px' }}>
      {[...options, ...(open ? more : [])].map((n) => (
        <button key={n} type="button" className="pill-toggle soft" aria-pressed={picked(n)} onClick={() => onPick(n)}>
          {n}
        </button>
      ))}
      {more.length > 0 && (
        <button type="button" className="pill-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Fewer' : `More names (${more.length})`}
        </button>
      )}
    </div>
  );
}

/** `folded`: just a "Pick a common name" link until tapped (photo reviews, where a name is already filled in). */
export function MedicineNameChips({ value, onPick, folded = false }: { value: string; onPick: (name: string) => void; folded?: boolean }) {
  // An empty name starts with the list open (that's the quickest way to fill it); a filled one starts folded.
  const [open, setOpen] = useState(!folded || !value.trim());
  if (!open) {
    return (
      <button type="button" className="link-btn" style={{ marginTop: '2px', fontSize: '0.84rem', alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
        Pick a common name
      </button>
    );
  }
  if (!folded) return <QuickChips options={NAME_CHIPS} more={MORE_NAME_CHIPS} label="Quick names" value={value} onPick={onPick} />;
  // Folded lists close again: by picking a name, or with "Hide common names".
  return (
    <>
      <QuickChips options={NAME_CHIPS} more={MORE_NAME_CHIPS} label="Quick names" value={value} onPick={(n) => { onPick(n); setOpen(false); }} />
      <button type="button" className="link-btn" style={{ marginTop: '2px', fontSize: '0.84rem', alignSelf: 'flex-start' }} onClick={() => setOpen(false)}>
        Hide common names
      </button>
    </>
  );
}

export function DoseChips({ value, onPick }: { value: string; onPick: (dose: string) => void }) {
  return <QuickChips options={DOSE_CHIPS} label="Quick doses" value={value} onPick={onPick} />;
}

const DAY_CHOICES: { days: number | null; label: string }[] = [
  { days: null, label: 'Ongoing' },
  { days: 3, label: '3 days' },
  { days: 5, label: '5 days' },
  { days: 7, label: '1 week' },
  { days: 10, label: '10 days' },
  { days: 15, label: '15 days' },
  { days: 30, label: '1 month' },
];

/** Marks a field the prescription line filled in, so the family knows to check it. */
export function FromPrescription() {
  return <span className="tag-filled" title="Filled in from the prescription. Please check it.">From prescription</span>;
}

/** "Saathi may say it's for infection": the reader's guess is only used once the family ticks it. */
export function PurposeSuggestion({ suggestion, value, onChange }: { suggestion: string; value?: string; onChange: (purpose: string | undefined) => void }) {
  return (
    <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '0.88rem', cursor: 'pointer' }}>
      <input type="checkbox" checked={value === suggestion} onChange={(e) => onChange(e.target.checked ? suggestion : undefined)} style={{ width: '17px', height: '17px', accentColor: 'var(--teal)', marginTop: '2px' }} />
      <span>
        Saathi may say it&apos;s <b>&ldquo;{suggestion}&rdquo;</b>
        <span className="form-hint" style={{ display: 'block' }}>Read from the prescription. Tick only if it&apos;s right.</span>
      </span>
    </label>
  );
}

/** "For how many more days?": Ongoing for regular medicines, or a course that ends by itself. */
export function CourseDays({ id, value, onChange, suggestedDays }: { id: string; value?: number | null; onChange: (days: number | null) => void; suggestedDays?: number }) {
  const [other, setOther] = useState(value && !DAY_CHOICES.some((c) => c.days === value) ? String(value) : '');
  const days = value ?? null;
  const lastDay = days ? new Date(`${istLastDayOfCourse(days)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : null;
  return (
    <>
      <div className="pill-group" role="radiogroup" aria-label="For how many more days?">
        {DAY_CHOICES.map((c) => (
          <button
            key={c.label}
            type="button"
            role="radio"
            aria-checked={!other && days === c.days}
            className="pill-toggle soft"
            onClick={() => { setOther(''); onChange(c.days); }}
          >
            {c.label}
          </button>
        ))}
        <label htmlFor={id} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.86rem' }}>
          Other
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            placeholder="days"
            value={other}
            onChange={(e) => {
              setOther(e.target.value);
              const n = parseInt(e.target.value, 10);
              onChange(n >= 1 && n <= 365 ? n : null);
            }}
            className="form-input"
            style={{ width: '84px', padding: '4px 10px', minHeight: '32px', height: '32px', borderRadius: 'var(--r-full)', fontSize: '0.84rem' }}
          />
        </label>
      </div>
      <span className="form-hint" style={{ display: 'block', marginTop: '6px' }}>
        {lastDay
          ? `Last day: ${lastDay}, counting from today. If they started earlier, pick fewer days. After that we stop asking about it.`
          : 'Keeps going every day until you stop it.'}
      </span>
      {!days && suggestedDays ? (
        <span className="form-hint" style={{ display: 'block', marginTop: '6px' }}>
          The prescription says {suggestedDays} days. For BP or sugar tablets that usually means &ldquo;until the next visit&rdquo;, so we keep asking.{' '}
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => {
              setOther(DAY_CHOICES.some((c) => c.days === suggestedDays) ? '' : String(suggestedDays));
              onChange(suggestedDays);
            }}
          >
            Stop after {suggestedDays} days
          </button>
        </span>
      ) : null}
    </>
  );
}

/** Under every medicine name field. */
export const NAME_HINT = "A real name isn't needed. We use exactly this name when we ask about it.";

const FOOD_OPTIONS: { val: FoodRelation; label: string }[] = [
  { val: 'before_food', label: 'Before food' },
  { val: 'after_food', label: 'After food' },
  { val: 'with_food', label: 'With food' },
  { val: 'not_specified', label: 'Any time' },
];

export function foodLabel(rel?: FoodRelation) {
  return FOOD_OPTIONS.find((o) => o.val === rel)?.label ?? 'Any time';
}

/** Single-select of how a medicine relates to meals. */
export function FoodPicker({ value, onChange }: { value?: FoodRelation; onChange: (v: FoodRelation) => void }) {
  const current = value || 'not_specified';
  return (
    <div className="pill-group" role="radiogroup" aria-label="With food?">
      {FOOD_OPTIONS.map((o) => (
        <button
          key={o.val}
          type="button"
          role="radio"
          aria-checked={current === o.val}
          className={`pill-toggle ${o.val === 'before_food' ? 'warn' : 'soft'}`}
          onClick={() => onChange(o.val)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
