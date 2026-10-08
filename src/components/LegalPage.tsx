import React from 'react';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';

/**
 * Contact address for legal requests. Set NEXT_PUBLIC_SUPPORT_EMAIL; without it the pages tell people to
 * write from the email address on their account instead of showing a wrong or empty address.
 */
export function ContactLine() {
  const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  return email ? (
    <a href={`mailto:${email}`}>{email}</a>
  ) : (
    <span>us from the email address registered on your Aaptha account</span>
  );
}

export const LEGAL_UPDATED = '3 October 2026';

export function LegalPage({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      <main>
        <div className="wrap-narrow" style={{ padding: '56px 20px 96px' }}>
          <article className="legal">
            <p style={{ fontSize: '0.84rem', color: 'var(--ink-muted)', marginBottom: '10px' }}>
              <Link href="/">Aaptha</Link> · Last updated {LEGAL_UPDATED}
            </p>
            <h1 style={{ fontSize: 'clamp(2rem, 4vw, 2.6rem)', marginBottom: '14px' }}>{title}</h1>
            <p className="legal-intro">{intro}</p>
            {children}
          </article>
        </div>
        <style>{`
          .legal { max-width: 720px; margin: 0 auto; color: var(--ink); line-height: 1.75; font-size: 0.98rem; }
          .legal-intro { color: var(--ink-muted); font-size: 1.05rem; margin-bottom: 28px; }
          .legal h2 { font-size: 1.3rem; margin: 34px 0 10px; letter-spacing: -0.01em; }
          .legal p { margin: 0 0 12px; }
          .legal ul { margin: 0 0 14px; padding-left: 22px; display: grid; gap: 6px; }
          .legal a { color: var(--teal-text, var(--teal)); text-decoration: underline; text-underline-offset: 3px; }
          .legal .callout { border: 1px solid var(--line); background: var(--panel); border-radius: 12px; padding: 14px 16px; margin: 18px 0; }
        `}</style>
      </main>
      <Footer />
    </>
  );
}
