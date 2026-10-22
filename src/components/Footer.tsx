import React from 'react';
import Link from 'next/link';
import { Brand } from '@/components/Navbar';
import { BusinessDetails } from '@/components/BusinessDetails';

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-grid">
          <div>
            <div style={{ marginBottom: '16px' }}>
              <Brand />
            </div>
            <p style={{ fontSize: '0.9rem', lineHeight: 1.65, maxWidth: '34ch' }}>
              A daily phone call for your parents, in their language. Quiet peace of mind for you.
            </p>
          </div>

          <div>
            <h4>Product</h4>
            <div style={{ display: 'grid', gap: '10px', fontSize: '0.9rem' }}>
              <Link href="/#how">How it works</Link>
              <Link href="/#remind">WhatsApp reminders</Link>
              <Link href="/#safety">Safety</Link>
              <Link href="/#why">Why Aaptha</Link>
              <Link href="/#plans">Pricing</Link>
              <Link href="/#faq">FAQ</Link>
            </div>
          </div>

          <div>
            <h4>Account</h4>
            <div style={{ display: 'grid', gap: '10px', fontSize: '0.9rem' }}>
              <Link href="/login">Log in</Link>
              <Link href="/signup">Create account</Link>
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/account/billing">Billing</Link>
            </div>
          </div>

          <div>
            <h4>Not an emergency service</h4>
            <p style={{ fontSize: '0.84rem', lineHeight: 1.6 }}>
              Aaptha is a family check-in companion. It does not give medical advice and is not a replacement for a doctor or for emergency services. In an emergency, call <strong style={{ color: '#fff' }}>112</strong>.
            </p>
          </div>
        </div>

        <div
          style={{
            borderTop: '1px solid rgba(255,255,255,0.12)',
            paddingTop: '24px',
            display: 'flex',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            fontSize: '0.82rem',
            color: 'rgba(255,255,255,0.5)'
          }}
        >
          <span>© {new Date().getFullYear()} Aaptha<BusinessDetails style={{ margin: '6px 0 0', maxWidth: '520px' }} /></span>
          <span style={{ display: 'inline-flex', gap: '18px', flexWrap: 'wrap' }}>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/refunds">Refunds</Link>
            <span>Made in India, for families who live apart.</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
