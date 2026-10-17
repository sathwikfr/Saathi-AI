import React from 'react';
import { LayoutDashboard, MessageCircle, Heart, Reply, ExternalLink, CheckCheck, Check, Link2 } from 'lucide-react';
import { Reveal } from '@/components/Reveal';
import { WordReveal } from '@/components/motion/WordReveal';
import { CALL_MS, formatCallTime } from './callScript';
import s from './home.module.css';
import x from './afterCall.module.css';

/**
 * "After every call": the same example call (the one on the phone above) as it
 * lands in two places, side by side: the dashboard card and the WhatsApp
 * update. Tapping "I'll handle it" on WhatsApp is what marks the dashboard
 * card as handled, so the two cards finish the same story.
 * The WhatsApp text is the real 'aaptha_call_alert' template (lib/whatsapp.ts)
 * with this call's details; mood words are the product's own (calm, anxious...).
 */

const ROWS = [
  { label: 'Amlodipine 5mg', value: 'Taken', tone: 'good' },
  { label: 'Mood', value: 'Calm', tone: 'calm' },
  { label: 'Mentioned', value: 'Knee pain', tone: 'warn' },
  { label: 'Call length', value: formatCallTime(CALL_MS), tone: 'plain' },
] as const;

export function AfterCallSection() {
  return (
    <section className="section">
      <div className="wrap">
        <Reveal className={s.head}>
          <WordReveal>Know how she is <span className={s.grad}>in ten seconds.</span></WordReveal>
          <p>Every call is summed up on your dashboard and sent to your WhatsApp. When something needs you, act on it with one tap.</p>
        </Reveal>

        <div className={x.pair}>
          {/* The dashboard */}
          <Reveal variant="left" className={x.col}>
            <div className={x.label} data-speed="0.5">
              <span><LayoutDashboard size={15} /> On your dashboard</span>
              <span className={x.example}>Example</span>
            </div>
            <div className={x.dash} data-speed="0.5">
              <div className={x.dashHead}>
                <span className={x.avatar} aria-hidden="true">A</span>
                <span className={x.who}>
                  <b>Amma</b>
                  <small>Morning check-in · 8:30 AM</small>
                </span>
                <span className={x.answered}><Check size={12} strokeWidth={3} /> Answered</span>
              </div>
              <p className={x.summary}>
                Amma took her BP tablet after breakfast. She said she’s feeling fine, but her knee has been hurting since yesterday.
              </p>
              <ul className={x.rows}>
                {ROWS.map((r) => (
                  <li key={r.label}>
                    <span>{r.label}</span>
                    <b className={x.pill} data-tone={r.tone}>{r.value}</b>
                  </li>
                ))}
              </ul>
              <div className={x.handled}>
                <span className={x.handledIcon}><Check size={13} strokeWidth={3} /></span>
                <span><b>Handled</b> · you tapped “I’ll handle it” on WhatsApp at 8:33 AM</span>
              </div>
            </div>
          </Reveal>

          <div className={x.same} aria-hidden="true">
            <span><Link2 size={15} /></span>
            <small>Same call</small>
          </div>

          {/* WhatsApp */}
          <Reveal variant="right" delay={120} className={x.col}>
            <div className={x.label} data-speed="-0.4">
              <span><MessageCircle size={15} /> On your WhatsApp</span>
            </div>
            <div className={x.wa} aria-label="Example WhatsApp update" data-speed="-0.4">
              <div className={x.waHead}>
                <span className={x.waAvatar}><Heart size={14} fill="currentColor" strokeWidth={0} /></span>
                <span className={x.who}>
                  <b>Aaptha</b>
                  <small>Call updates</small>
                </span>
              </div>
              <div className={x.waBody}>
                <div className={x.waIn}>
                  <p>
                    Your scheduled check-in call with Amma needs your attention. Details: Amma mentioned not feeling well:
                    “knee pain since yesterday”. Please check in with them today. Call details: Answered the morning call
                    at 8:30 AM. Medicines: Amlodipine taken. Mood: calm.
                  </p>
                  <p className={x.waNote}>This alert is part of the care plan you set up on Aaptha.</p>
                  <time>8:31 AM</time>
                  <div className={x.waBtns}>
                    <span><Reply size={14} /> I’ll handle it</span>
                    <span><Reply size={14} /> Call again</span>
                    <span><ExternalLink size={14} /> Open Aaptha</span>
                  </div>
                </div>
                <div className={x.waOut}>
                  <p>I’ll handle it</p>
                  <time>8:33 AM <CheckCheck size={14} /></time>
                </div>
                <div className={x.waIn}>
                  <p>Thanks. We have marked this as handled on your Aaptha dashboard.</p>
                  <time>8:33 AM</time>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
