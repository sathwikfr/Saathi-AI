'use client';

import React from 'react';
import { PageTransition } from '@/components/motion/PageTransition';
import Link from 'next/link';
import { Check, Lock } from 'lucide-react';
import { Brand } from '@/components/Navbar';
import { ThemeToggle } from '@/components/ThemeToggle';

const STEPS = ['Account', 'Plan', 'Payment', 'Done'];

/** Focused frame for the checkout flow: brand, progress, no marketing nav. */
export function CheckoutShell({ step, children, wide = true }: { step: 1 | 2 | 3 | 4; children: React.ReactNode; wide?: boolean }) {
  return (
    <>
      <header className="wizard-top">
        <div className="wrap wizard-top-inner">
          <Brand />
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.84rem', color: 'var(--ink-muted)' }}>
              <Lock size={14} /> Secure checkout
            </span>
            <ThemeToggle />
          </div>
        </div>
        <div className="wizard-progress" aria-hidden="true">
          <i style={{ width: `${(step / STEPS.length) * 100}%` }} />
        </div>
      </header>
      <PageTransition>
      <main id="main" className="wrap" style={{ flex: 1, paddingBottom: '80px' }}>
        <ol className="wizard-steps" aria-label="Checkout progress" style={{ listStyle: 'none' }}>
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
        <div style={{ maxWidth: wide ? '1000px' : '640px', margin: '24px auto 0' }} className="animate-fade-in">
          {children}
        </div>
      </main>
      </PageTransition>
    </>
  );
}

export function PageTitle({ title, sub, center = true }: { title: React.ReactNode; sub?: React.ReactNode; center?: boolean }) {
  return (
    <div style={{ textAlign: center ? 'center' : 'left', maxWidth: '620px', margin: center ? '0 auto 32px' : '0 0 28px' }}>
      <h1 style={{ fontSize: 'clamp(1.9rem, 3.4vw, 2.6rem)', letterSpacing: '-0.03em', marginBottom: '10px' }}>{title}</h1>
      {sub && <p style={{ fontSize: '1rem', color: 'var(--ink-muted)' }}>{sub}</p>}
    </div>
  );
}

/** Accessible custom checkbox row (real input, styled box). */
export function CheckRow({ checked, onChange, title, children }: { checked: boolean; onChange: (v: boolean) => void; title: string; children: React.ReactNode }) {
  return (
    <label
      className="checkbox-group"
      style={{
        margin: '0 0 10px',
        padding: '14px 16px',
        borderRadius: 'var(--r-md)',
        border: `1.5px solid ${checked ? 'var(--teal)' : 'var(--line-subtle)'}`,
        background: checked ? 'var(--teal-light)' : 'var(--panel-elevated)',
        transition: 'all 200ms ease'
      }}
    >
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={`checkbox-custom ${checked ? 'checked' : ''}`} aria-hidden="true">
        {checked && <Check size={14} strokeWidth={3} />}
      </span>
      <span>
        <strong style={{ color: 'var(--ink)', display: 'block', marginBottom: '2px', fontSize: '0.92rem' }}>{title}</strong>
        <span style={{ fontSize: '0.84rem' }}>{children}</span>
      </span>
    </label>
  );
}

export function SummaryRow({ label, value, strong, tone }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean; tone?: 'green' }) {
  return (
    <div className={`summary-row${strong ? ' strong' : ''}`}>
      <span>{label}</span>
      <b style={tone === 'green' ? { color: 'var(--green)' } : undefined}>{value}</b>
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} transitionTypes={['nav-back']} className="btn btn-quiet btn-sm" style={{ marginBottom: '8px' }}>
      {children}
    </Link>
  );
}
