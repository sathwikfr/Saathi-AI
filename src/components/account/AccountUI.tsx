'use client';

import React from 'react';
import { PageTransition } from '@/components/motion/PageTransition';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';

const SECTIONS = [
  { href: '/account/profile', label: 'Profile & notifications', id: 'profile' },
  { href: '/account/billing', label: 'Subscription & billing', id: 'billing' },
] as const;

/** Shared frame for account pages: app nav, title, and section switcher. */
export function AccountShell({
  active, title, sub, children
}: { active: 'profile' | 'billing'; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      <PageTransition>
      <main id="main" className="wrap dash-page">
        <div className="dash-head" style={{ marginBottom: '20px' }}>
          <div>
            <span className="eyebrow">Your account</span>
            <h1 style={{ fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', letterSpacing: '-0.03em' }}>{title}</h1>
            {sub && <p style={{ color: 'var(--ink-muted)', marginTop: '6px' }}>{sub}</p>}
          </div>
        </div>
        <nav className="tabbar" aria-label="Account sections">
          {SECTIONS.map((s) => (
            <Link key={s.id} href={s.href} className="tab" aria-current={active === s.id ? 'page' : undefined}>
              {s.label}
            </Link>
          ))}
        </nav>
        <div className="animate-fade-in">{children}</div>
      </main>
      </PageTransition>
    </>
  );
}
