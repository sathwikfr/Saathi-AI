'use client';

import React, { useState } from 'react';
import { ClipboardList, Copy, MessageCircle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { ModalTitle } from './DashboardModals';
import { Medicine, CallLog, ParentProfile } from '@/lib/types';
import { chemistMessage } from '@/lib/familyMoney';
import { medicineKey } from '@/lib/callInterpretation';
import { whatsappShareLink, copyText, formatPhone } from './helpers';

type Row = { id: string; name: string; dosage: string; quantity: string; picked: boolean };

/** Medicines the parent said were running low on a call in the last two weeks. */
function runningLow(callLogs: CallLog[], now: number): Set<string> {
  const since = now - 14 * 86400000;
  return new Set(
    callLogs
      .filter(c => c.status === 'answered' && new Date(c.createdAt || c.scheduledTime).getTime() >= since)
      .flatMap(c => c.details?.runningLow || [])
      .map(medicineKey)
  );
}

/**
 * A refill list the family sends to their usual chemist on WhatsApp, themselves.
 * Aaptha doesn't order, pay or deliver anything.
 */
export function RefillListModal({ open, onClose, parent, medicines, callLogs, senderName }: {
  open: boolean;
  onClose: () => void;
  parent: ParentProfile;
  medicines: Medicine[];
  callLogs: CallLog[];
  senderName: string;
}) {
  const [now] = useState(() => Date.now());
  const low = runningLow(callLogs, now);
  const active = medicines.filter(m => m.isActive);
  const anyLow = active.some(m => low.has(medicineKey(m.name)));
  const [rows, setRows] = useState<Row[]>(() =>
    active.map(m => ({ id: m.id, name: m.name, dosage: m.dosage, quantity: '1 strip', picked: anyLow ? low.has(medicineKey(m.name)) : true }))
  );
  const [copied, setCopied] = useState(false);

  const text = chemistMessage({
    chemistName: parent.chemistName,
    parentName: parent.name,
    address: parent.address,
    phone: formatPhone(parent.phone),
    senderName: senderName.split(' ')[0] || 'family',
    items: rows.filter(r => r.picked).map(r => ({ name: r.name, dosage: r.dosage, quantity: r.quantity }))
  });
  const picked = rows.some(r => r.picked);

  return (
    <Modal open={open} onClose={onClose} labelledBy="refill-title" width={620}>
      <ModalTitle
        id="refill-title"
        icon={<ClipboardList size={20} />}
        title="Refill list for the chemist"
        sub={`You send it yourself on WhatsApp${parent.chemistName ? ` to ${parent.chemistName}` : ''}. Aaptha doesn't order or pay for anything.`}
      />
      {anyLow && <div className="notice" style={{ marginBottom: '12px' }}><span>Ticked: what {parent.name} said was running low on recent calls.</span></div>}
      {active.length === 0 ? (
        <p>No active medicines.</p>
      ) : (
        <div style={{ display: 'grid', gap: '6px', marginBottom: '14px' }}>
          {rows.map((r, i) => (
            <div key={r.id} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input
                type="checkbox"
                id={`refill-${r.id}`}
                checked={r.picked}
                onChange={e => setRows(l => l.map((x, j) => (j === i ? { ...x, picked: e.target.checked } : x)))}
              />
              <label htmlFor={`refill-${r.id}`} style={{ flex: 1, minWidth: 0, fontSize: '0.92rem' }}>
                <b>{r.name}</b> <span style={{ color: 'var(--ink-muted)' }}>{r.dosage}</span>
              </label>
              <input
                className="form-input"
                aria-label={`How much ${r.name}`}
                style={{ width: '130px', padding: '6px 10px', fontSize: '0.88rem' }}
                value={r.quantity}
                maxLength={30}
                onChange={e => setRows(l => l.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
              />
            </div>
          ))}
        </div>
      )}
      <label className="form-label" htmlFor="refill-preview">Message</label>
      <textarea id="refill-preview" className="form-input" rows={7} readOnly value={text} style={{ fontSize: '0.88rem', marginBottom: '14px' }} />
      {!parent.chemistPhone && (
        <p className="form-hint" style={{ marginBottom: '10px' }}>Add the chemist&apos;s WhatsApp number in Settings to open their chat directly.</p>
      )}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <a
          className="btn btn-primary"
          style={picked ? undefined : { pointerEvents: 'none' }}
          aria-disabled={!picked}
          href={picked ? whatsappShareLink(text, parent.chemistPhone || undefined) : undefined}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MessageCircle size={16} /> Open in WhatsApp
        </a>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!picked}
          onClick={async () => {
            setCopied(await copyText(text));
            window.setTimeout(() => setCopied(false), 2000);
          }}
        >
          <Copy size={15} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </Modal>
  );
}
