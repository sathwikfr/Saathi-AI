'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Users, AlertTriangle } from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { useAuth } from '@/context/AuthContext';

type Preview = { name: string; role: 'viewer' | 'co_manager'; parentName: string; inviterName: string };

/** A family member opens their invite link: see who invited them, then sign up / log in and accept. */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { user, loading } = useAuth();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/invites/${encodeURIComponent(token)}`)
      .then(async r => ({ ok: r.ok, data: await r.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (ok) setPreview(data);
        else setError(data.error || 'This invite link has already been used or was cancelled.');
      })
      .catch(() => !cancelled && setError('Could not load the invite.'));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const accept = async () => {
    setAccepting(true);
    const res = await fetch(`/api/invites/${encodeURIComponent(token)}`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setAccepting(false);
    if (res.ok) router.push('/dashboard');
    else setError(data.error || 'Could not accept the invite.');
  };

  const back = encodeURIComponent(`/invite/${token}`);

  return (
    <>
      <Navbar />
      <main id="main" className="wrap-narrow" style={{ padding: '56px 16px 96px' }}>
        <div className="panel" style={{ maxWidth: '520px', margin: '0 auto', padding: '36px 28px' }}>
          {error ? (
            <div className="empty" style={{ padding: 0 }}>
              <span className="icon-tile gold"><AlertTriangle size={24} /></span>
              <h3>Invite not available</h3>
              <p>{error}</p>
              <Link href="/dashboard" className="btn btn-ghost">Go to the dashboard</Link>
            </div>
          ) : !preview ? (
            <div className="skeleton" style={{ height: '180px' }} aria-label="Loading" />
          ) : (
            <>
              <span className="icon-tile" style={{ marginBottom: '14px' }}><Users size={22} /></span>
              <h1 style={{ fontSize: '1.6rem', letterSpacing: '-0.02em', marginBottom: '10px' }}>
                {preview.inviterName.split(' ')[0]} invited you to help look after {preview.parentName}
              </h1>
              <p style={{ color: 'var(--ink-muted)', marginBottom: '22px' }}>
                Aaptha&apos;s assistant Saathi phones {preview.parentName} about their medicines. You will see each call&apos;s result,
                get your own updates, and can say &ldquo;I&apos;m on it&rdquo; when something needs attention.
                {preview.role === 'co_manager' ? ' You can also manage the calls and medicines.' : ''} You don&apos;t need a plan of your own.
              </p>
              {user ? (
                <button className="btn btn-primary btn-lg btn-block" onClick={accept} disabled={accepting}>
                  {accepting ? <><span className="spinner" /> Joining…</> : `Join as ${user.name.split(' ')[0]}`}
                </button>
              ) : loading ? (
                <div className="skeleton" style={{ height: '48px' }} />
              ) : (
                <div style={{ display: 'grid', gap: '10px' }}>
                  <Link className="btn btn-primary btn-lg btn-block" href={`/signup?redirect=${back}`}>Create an account</Link>
                  <Link className="btn btn-ghost btn-block" href={`/login?redirect=${back}`}>I already have an account</Link>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}
