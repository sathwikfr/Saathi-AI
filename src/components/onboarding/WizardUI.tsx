'use client';

import React from 'react';
import Link from 'next/link';
import { Check, X } from 'lucide-react';
import { Brand } from '@/components/Navbar';
import { ThemeToggle } from '@/components/ThemeToggle';
import { FoodRelation, MedicineTimingSlot } from '@/lib/types';

const STEPS = ['Parent', 'Medicines', 'Call times', 'Emergency plan', 'Consent'];

/** Focused full-page frame for the onboarding wizard. */
export function WizardShell({ step, children }: { step: number; children: React.ReactNode }) {
  const pct = Math.min(100, ((step - 1) / STEPS.length) * 100 + (step > STEPS.length ? 0 : 100 / STEPS.length / 2));
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
          <i style={{ width: `${step > STEPS.length ? 100 : pct}%` }} />
        </div>
      </header>
      <main id="main" className="wrap" style={{ paddingBottom: '80px', flex: 1 }}>
        {step <= STEPS.length && (
          <ol className="wizard-steps" aria-label="Setup progress" style={{ listStyle: 'none' }}>
            {STEPS.map((label, i) => {
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
        <div className="wizard-panel">{children}</div>
      </main>
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
