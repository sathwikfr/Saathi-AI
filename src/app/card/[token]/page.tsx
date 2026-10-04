import React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = {
  title: 'Emergency card — Aaptha',
  // A private link: never indexed, and the token is not sent on to other sites.
  robots: { index: false, follow: false },
  referrer: 'no-referrer'
};

function fmtPhone(phone?: string | null) {
  const m = /^\+91(\d{5})(\d{5})$/.exec(phone || '');
  return m ? `+91 ${m[1]} ${m[2]}` : phone || '';
}

/**
 * The emergency card a family shares with a neighbour, building security or a hospital.
 * Read-only, public to whoever has the (unguessable, revocable) link. No call history.
 */
export default async function EmergencyCardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) notFound();
  const parent = await prisma.parentProfile.findUnique({
    where: { cardToken: token },
    include: {
      medicines: { where: { isActive: true }, orderBy: { createdAt: 'asc' } },
      emergencyContacts: { orderBy: { createdAt: 'asc' } },
      user: { select: { name: true, phone: true } }
    }
  });
  if (!parent || parent.isDeleted) notFound();

  const contacts = [...parent.emergencyContacts].sort((a, b) => Number(b.isLocal) - Number(a.isLocal));

  return (
    <main style={{ padding: '32px 16px 64px', minHeight: '100vh', background: 'var(--paper)' }}>
      <article className="card-sheet print-sheet">
        <p style={{ fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--red)' }}>Emergency card</p>
        <h1>{parent.name}</h1>
        <div className="sos">In an emergency call 112 (ambulance 108). Then call the family below.</div>

        <dl>
          <dt>Phone</dt>
          <dd><a href={`tel:${parent.phone}`}>{fmtPhone(parent.phone)}</a></dd>
          {parent.address && (<><dt>Address</dt><dd>{parent.address}</dd></>)}
          {parent.bloodGroup && (<><dt>Blood group</dt><dd>{parent.bloodGroup}</dd></>)}
          {parent.conditions && (<><dt>Health conditions</dt><dd>{parent.conditions}</dd></>)}
          {parent.allergies && (<><dt>Allergies</dt><dd>{parent.allergies}</dd></>)}
          <dt>Current medicines</dt>
          <dd>
            {parent.medicines.length === 0
              ? 'None listed'
              : parent.medicines.map(m => `${m.name} (${m.dosage})`).join(', ')}
          </dd>
          {parent.nearestHospital && (<><dt>Nearest hospital</dt><dd>{parent.nearestHospital}</dd></>)}
          {parent.doctorName && (
            <>
              <dt>Doctor</dt>
              <dd>
                {parent.doctorName}
                {parent.doctorPhone && <> · <a href={`tel:${parent.doctorPhone}`}>{fmtPhone(parent.doctorPhone)}</a></>}
              </dd>
            </>
          )}
          {parent.livesAlone && (<><dt>Lives</dt><dd>Alone</dd></>)}
        </dl>

        <h2 style={{ fontSize: '1.05rem', marginTop: '24px', marginBottom: '8px' }}>Family and people nearby</h2>
        <dl style={{ marginTop: 0 }}>
          {contacts.map(c => (
            <React.Fragment key={c.id}>
              <dt>{c.name}{c.isLocal ? ' (nearby)' : ''}</dt>
              <dd><a href={`tel:${c.phone}`}>{fmtPhone(c.phone)}</a>{c.relation ? ` · ${c.relation}` : ''}</dd>
            </React.Fragment>
          ))}
        </dl>

        <p style={{ marginTop: '24px', fontSize: '0.8rem', color: 'var(--ink-muted)' }}>
          Kept up to date by {parent.user.name.split(' ')[0]}&apos;s family on Aaptha. Written by the family, not a medical record.
        </p>
      </article>
    </main>
  );
}

