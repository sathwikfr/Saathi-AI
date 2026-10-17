'use client';

import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { AlertTriangle, Check, MessageCircle, Phone, PhoneCall } from 'lucide-react';
import f from './safetyFilm.module.css';

/**
 * "If something is wrong": a 15 s Remotion film (360x640, 30 fps) of the real emergency ladder
 * (lib/escalation.ts). Amma mentions a warning sign on a call, Saathi stays calm and points her to 112,
 * a level-4 alert reaches the family on WhatsApp, round 0 phones you and the first nearby contact at
 * once (the next contact 10 minutes later), and the first "I'm on it" stops the ladder and tells
 * everyone. Every frame is computed from the frame number; nothing here is fetched.
 */

export const SAFETY_FILM = { fps: 30, durationInFrames: 450, width: 360, height: 640 };

const ACTS = [
  { from: 0, to: 135, caption: 'She mentions a warning sign.' },
  { from: 135, to: 225, caption: 'You hear about it at once.' },
  { from: 225, to: 345, caption: 'We phone the people nearest her.' },
  { from: 345, to: 450, caption: 'Until someone is on it.' },
];

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** 0 → 1 with a soft spring from `at`. */
function useIn(at: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - at, fps, config: { damping: 18, stiffness: 120 } });
}

/** Slides in from below at `at`, lifts away before `out`. */
function Enter({ at, out, children, className, style }: { at: number; out?: number; children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const frame = useCurrentFrame();
  const p = useIn(at);
  const q = out === undefined ? 0 : interpolate(frame, [out - 12, out], [0, 1], clamp);
  return (
    <div className={className} style={{ ...style, opacity: p * (1 - q), transform: `translateY(${(1 - p) * 22 - q * 18}px)` }}>
      {children}
    </div>
  );
}

function Act({ i, children }: { i: number; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const { from, to } = ACTS[i];
  if (frame < from - 1 || frame >= to) return null;
  const out = i < ACTS.length - 1 ? interpolate(frame, [to - 14, to], [0, 1], clamp) : 0;
  return <div className={f.act} style={{ opacity: 1 - out, transform: `translateY(${-out * 26}px)` }}>{children}</div>;
}

function Caption() {
  const frame = useCurrentFrame();
  return (
    <div className={f.captions}>
      {ACTS.map((a, i) => {
        const p = interpolate(frame, [a.from + 4, a.from + 18], [0, 1], clamp);
        const q = i < ACTS.length - 1 ? interpolate(frame, [a.to - 10, a.to], [0, 1], clamp) : 0;
        if (frame < a.from || frame >= a.to) return null;
        return (
          <p key={a.caption} className={f.caption} style={{ opacity: p * (1 - q), transform: `translateY(${(1 - p) * 14 - q * 10}px)` }}>
            {a.caption}
          </p>
        );
      })}
    </div>
  );
}

/** Act 1: mid-call, Amma says her chest feels tight. */
function CallAct() {
  const frame = useCurrentFrame();
  const flag = interpolate(frame, [62, 74], [0, 1], clamp);
  return (
    <Act i={0}>
      <div className={f.callHead}>
        <span className={f.callDot} />
        <b>Saathi</b>
        <small>morning check-in · 0:{String(38 + Math.floor(frame / 30)).padStart(2, '0')}</small>
      </div>
      <Enter at={8} className={`${f.bubble} ${f.saathi}`}><small>Saathi</small>How are you feeling today?</Enter>
      <Enter at={34} className={`${f.bubble} ${f.amma}`} style={{ boxShadow: `0 0 0 ${flag * 3}px rgba(255, 90, 80, 0.45)` }}>
        <small>Amma</small>My chest feels tight…
      </Enter>
      <Enter at={64} className={f.flag}><AlertTriangle size={13} /> Warning sign heard</Enter>
      <Enter at={84} className={`${f.bubble} ${f.saathi}`}>
        <small>Saathi</small>Please sit down, Amma. I’m telling Ravi right now. If it gets worse, call 112.
      </Enter>
    </Act>
  );
}

/** Act 2: the urgent alert on the dashboard and on WhatsApp. */
function AlertAct() {
  const frame = useCurrentFrame();
  const pulse = 0.5 + 0.5 * Math.sin((frame - 135) / 4);
  return (
    <Act i={1}>
      <Enter at={142} className={f.alert}>
        <span className={f.alertBadge} style={{ boxShadow: `0 0 0 ${pulse * 6}px rgba(255, 90, 80, ${0.25 * (1 - pulse)})` }}>
          <AlertTriangle size={16} />
        </span>
        <span className={f.alertText}>
          <em>Urgent</em>
          <b>Amma said her chest feels tight</b>
          <small>8:32 AM · during the morning call</small>
        </span>
      </Enter>
      <Enter at={168} className={f.wa}>
        <MessageCircle size={15} /> Sent to the family on WhatsApp
      </Enter>
      <Enter at={184} className={f.wa}>
        <PhoneCall size={15} /> Calling the people nearest her
      </Enter>
    </Act>
  );
}

function Ring({ at, answered }: { at: number; answered: boolean }) {
  const frame = useCurrentFrame();
  const shake = answered ? 0 : Math.sin((frame - at) / 1.6) * 9 * (Math.floor((frame - at) / 12) % 2);
  return (
    <span className={f.ring} data-ok={answered || undefined} style={{ transform: `rotate(${shake}deg)` }}>
      {answered ? <Check size={15} strokeWidth={3} /> : <Phone size={15} fill="currentColor" strokeWidth={0} />}
    </span>
  );
}

/** Act 3: round 0 rings you and the nearest contact together; Priya answers "I'm on it". */
function LadderAct() {
  const frame = useCurrentFrame();
  const onIt = frame >= 292;
  const told = useIn(300);
  return (
    <Act i={2}>
      <Enter at={232} className={f.row} style={{ borderColor: onIt ? 'rgba(48, 209, 88, 0.6)' : undefined }}>
        <Ring at={232} answered={onIt} />
        <span className={f.rowText}>
          <b>Priya</b>
          <small>{onIt ? '“I’m on it”' : 'Neighbour, 2 min away · calling…'}</small>
        </span>
      </Enter>
      <Enter at={240} className={f.row}>
        <Ring at={240} answered={false} />
        <span className={f.rowText}>
          <b>Ravi (you)</b>
          <small>{onIt ? 'Told: Priya is handling it' : 'Calling…'}</small>
        </span>
      </Enter>
      <Enter at={252} className={`${f.row} ${f.next}`} style={{ opacity: onIt ? 0.35 : undefined }}>
        <span className={f.ring} data-wait><Phone size={15} /></span>
        <span className={f.rowText}>
          <b>Suresh</b>
          <small>{onIt ? 'Not needed' : 'Next, in 10 min if no one answers'}</small>
        </span>
      </Enter>
      {onIt && <div className={f.stamp} style={{ opacity: told, transform: `scale(${0.9 + told * 0.1})` }}>Ladder stopped · everyone told</div>}
    </Act>
  );
}

/** Act 4: calm. */
function DoneAct() {
  const tick = useIn(352);
  return (
    <Act i={3}>
      <div className={f.done}>
        <span className={f.doneMark} style={{ transform: `scale(${tick})` }}><Check size={34} strokeWidth={3} /></span>
        <Enter at={360} className={f.doneTitle}>Priya is on her way to Amma.</Enter>
        <Enter at={372} className={f.doneSub}>Ravi and the family can see who is handling it.</Enter>
      </div>
      <Enter at={392} className={f.note}>Aaptha is not an emergency service. In an emergency, call 112.</Enter>
    </Act>
  );
}

export function SafetyFilm() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  // Fade at both ends so the loop has no seam.
  const fade = interpolate(frame, [0, 8, durationInFrames - 14, durationInFrames - 1], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill className={f.film}>
      <div className={f.bg} style={{ transform: `translateY(${-frame * 0.06}px)` }} />
      <div className={f.inner} style={{ opacity: fade }}>
        <span className={f.example}>Example</span>
        <Caption />
        <div className={f.stage}>
          <CallAct />
          <AlertAct />
          <LadderAct />
          <DoneAct />
        </div>
      </div>
    </AbsoluteFill>
  );
}
