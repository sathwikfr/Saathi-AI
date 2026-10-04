'use client';

import React, { useState } from 'react';
import { Check, Copy, Download, MessageCircle, ShieldCheck, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { ParentProfile, EmergencyContact } from '@/lib/types';
import { introScript, noticeLangFor, NOTICES } from '@/lib/parentNotices';
import { copyText, formatPhone, whatsappShareLink } from './helpers';

type Props = {
  parent: ParentProfile;
  familyName: string;
  contacts: EmergencyContact[];
  saathiNumber: string | null;
  firstCallTime: string | null;
  onChanged: () => void;
  onToast: (text: string, type?: 'success' | 'info' | 'error') => void;
  onOpenFamily: () => void;
};

/**
 * Trust set-up before (and just after) the first calls: elders are taught to hang up
 * on strangers, so Saathi should arrive as a caller they already know about.
 */
export function SetupChecklist({ parent, familyName, contacts, saathiNumber, firstCallTime, onChanged, onToast, onOpenFamily }: Props) {
  const [showScript, setShowScript] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const lang = noticeLangFor(parent.language);
  const script = introScript(lang, { parentName: parent.name, time: firstCallTime || parent.callTime, familyName: familyName.split(' ')[0] });
  const englishScript = lang === 'en' ? null : introScript('en', { parentName: parent.name, time: firstCallTime || parent.callTime, familyName: familyName.split(' ')[0] });
  const noticeUrl = typeof window !== 'undefined' ? `${window.location.origin}/notice/${lang}` : `/notice/${lang}`;

  const consent = parent.parentConsent;
  const hasLocal = contacts.some(c => c.isLocal);
  const practised = contacts.some(c => c.practiceAt);
  const steps = [
    { key: 'consent', done: consent === 'given' },
    { key: 'introduced', done: !!parent.introducedAt },
    { key: 'number', done: !!parent.numberSavedAt },
    { key: 'plan', done: !!parent.address && hasLocal },
    { key: 'practice', done: practised }
  ];
  const doneCount = steps.filter(s => s.done).length;
  if (doneCount === steps.length) return null;

  const mark = async (step: 'introduced' | 'number_saved', done = true) => {
    const res = await fetch(`/api/parents/${parent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setup_step', step, done })
    });
    if (res.ok) onChanged();
    else onToast('Could not save that. Please try again.', 'error');
  };

  return (
    <section className="panel" aria-labelledby="setup-title" style={{ marginBottom: '20px' }}>
      <div className="panel-head" style={{ marginBottom: collapsed ? 0 : undefined }}>
        <div>
          <h3 id="setup-title"><ShieldCheck size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />Help {parent.name} trust Saathi</h3>
          <p>{doneCount} of {steps.length} done. Elders are rightly wary of unknown callers; these steps make Saathi a caller they expect.</p>
        </div>
        <button className="btn btn-quiet btn-sm" onClick={() => setCollapsed(c => !c)} aria-expanded={!collapsed}>
          {collapsed ? <><ChevronDown size={15} /> Show</> : <><ChevronUp size={15} /> Hide</>}
        </button>
      </div>

      {!collapsed && (
        <ol className="checklist">
          <li className={steps[0].done ? 'done' : ''}>
            <span className="tick">{steps[0].done && <Check size={14} strokeWidth={3} />}</span>
            <div>
              <strong>{parent.name} says yes on the first call</strong>
              <span>
                {consent === 'given'
                  ? `Said yes${parent.parentConsentAt ? ` on ${new Date(parent.parentConsentAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}.`
                  : consent === 'declined' || consent === 'withdrawn'
                    ? `${parent.name} said no, so calls are paused. Talk with them first; resuming lets Saathi ask again.`
                    : `Saathi explains in two sentences what it does and that you will see the results, then asks if that's okay. No yes, no more calls.`}
              </span>
            </div>
          </li>

          <li className={steps[1].done ? 'done' : ''}>
            <span className="tick">{steps[1].done && <Check size={14} strokeWidth={3} />}</span>
            <div style={{ flex: 1 }}>
              <strong>Tell {parent.name} about Saathi yourself</strong>
              <span>A WhatsApp voice note or message from you works best. Here is what to say, in {NOTICES[lang].label}:</span>
              {showScript && (
                <div className="card-flat" style={{ marginTop: '8px', background: 'var(--paper)', padding: '12px 14px' }}>
                  <p className="quote" style={{ fontSize: '0.95rem' }}>{script}</p>
                  {englishScript && <p style={{ fontSize: '0.82rem', color: 'var(--ink-muted)', marginTop: '6px' }}>In English: {englishScript}</p>}
                </div>
              )}
              <div className="row-actions">
                {!showScript && <button className="btn btn-ghost btn-sm" onClick={() => setShowScript(true)}>Show what to say</button>}
                <a className="btn btn-ghost btn-sm" href={whatsappShareLink(script, parent.phone)} target="_blank" rel="noreferrer">
                  <MessageCircle size={14} /> Send on WhatsApp
                </a>
                <button className="btn btn-quiet btn-sm" onClick={async () => onToast((await copyText(script)) ? 'Copied.' : 'Could not copy.', 'info')}>
                  <Copy size={14} /> Copy
                </button>
                <a className="btn btn-quiet btn-sm" href={whatsappShareLink(`${NOTICES[lang].title}: ${noticeUrl}`, parent.phone)} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} /> Share the short notice
                </a>
                {!steps[1].done && <button className="btn btn-primary btn-sm" onClick={() => mark('introduced')}>I&apos;ve told them</button>}
              </div>
            </div>
          </li>

          <li className={steps[2].done ? 'done' : ''}>
            <span className="tick">{steps[2].done && <Check size={14} strokeWidth={3} />}</span>
            <div>
              <strong>Save Saathi&apos;s number on {parent.name}&apos;s phone</strong>
              <span>
                {saathiNumber
                  ? `Saathi always calls from ${formatPhone(saathiNumber)}. Saved as "Saathi (Aaptha)", it never shows up as an unknown caller.`
                  : "Saathi's fixed calling number appears here once calling is live."}
              </span>
              <div className="row-actions">
                {saathiNumber && (
                  <a className="btn btn-ghost btn-sm" href="/api/saathi/contact" download="Saathi.vcf">
                    <Download size={14} /> Contact card
                  </a>
                )}
                {!steps[2].done && <button className="btn btn-primary btn-sm" onClick={() => mark('number_saved')}>It&apos;s saved</button>}
              </div>
            </div>
          </li>

          <li className={steps[3].done ? 'done' : ''}>
            <span className="tick">{steps[3].done && <Check size={14} strokeWidth={3} />}</span>
            <div>
              <strong>Add {parent.name}&apos;s address and someone nearby</strong>
              <span>In an emergency we phone you and a neighbour or relative close to {parent.name}, with the address.</span>
              {!steps[3].done && <div className="row-actions"><button className="btn btn-ghost btn-sm" onClick={onOpenFamily}>Open the emergency plan</button></div>}
            </div>
          </li>

          <li className={steps[4].done ? 'done' : ''}>
            <span className="tick">{steps[4].done && <Check size={14} strokeWidth={3} />}</span>
            <div>
              <strong>Send a practice alert</strong>
              <span>A short practice call so your nearby contact knows what a real alert sounds like.</span>
              {!steps[4].done && <div className="row-actions"><button className="btn btn-ghost btn-sm" onClick={onOpenFamily}>Choose who</button></div>}
            </div>
          </li>
        </ol>
      )}
    </section>
  );
}
