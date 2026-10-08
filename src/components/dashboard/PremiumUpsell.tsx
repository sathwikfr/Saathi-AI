import React from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { PLANS } from '@/lib/plans';

/**
 * Shown in place of a Family / Extended feature on Solo (lib/plans.ts `premium`).
 * Only the account owner (who pays) gets the upgrade link.
 */
export function PremiumUpsell({ title, text, isOwner, compact = false }: { title: string; text: string; isOwner: boolean; compact?: boolean }) {
  return (
    <section className={compact ? 'pref-block' : 'panel'} aria-label={title} style={compact ? undefined : { display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
      {!compact && <span className="icon-tile gold"><Sparkles size={20} /></span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ display: 'block', marginBottom: '4px' }}>{title}</strong>
        <p style={{ fontSize: '0.88rem', color: 'var(--ink-muted)', margin: 0 }}>
          {text} Comes with {PLANS.family.name} and {PLANS.extended.name}.
        </p>
        {isOwner && (
          <Link href="/checkout/confirm?plan=family" className="btn btn-ghost btn-sm" style={{ marginTop: '10px' }}>
            See {PLANS.family.name} (₹{PLANS.family.priceMonthly.toLocaleString('en-IN')}/month)
          </Link>
        )}
      </div>
    </section>
  );
}
