'use client';

import React, { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Heart, ChevronLeft, Video, Phone, Reply, Plus, Camera, Mic, CheckCheck, MessageCircle } from 'lucide-react';
import c from '@/components/landing/liveCallPhone.module.css';
import { PLANS } from '@/lib/plans';
import { Shell, StatusBar, prog, expoOut, easeIn, easeInOut, inOut, centred, mixCam, syncAnimations, DW, DH, type Cam } from './BragFilm';
import s from './brag.module.css';
import r from './remind.module.css';

/**
 * The Remind film (₹99 WhatsApp medicine checks), the sister of the /brag call film: 1080x1920, 24 s, every
 * frame a pure function of `t` (window.__brag.seek, captured by brag-output/work/capture.mjs). Storyboard:
 * brag-output/remind-plan.md. The phones are also the landing page's Remind section (RemindSection.tsx).
 * Every message is the product's own text: the aaptha_medicine_check and aaptha_caretaker_alert templates
 * (lib/whatsapp.ts), the replies and the caretaker line from lib/reminders.ts; the buttons are the real ones.
 */

export const R_DURATION = 24000;

/* ---------- Timeline (ms) ---------- */

const NOTIF_AT = 700;          // the notification drops onto the lock screen
const NOTIF_TAP = 2200;
export const CHAT_AT = 2900;   // into the chat
const ASK1_AT = 3300;
export const NOT_YET_AT = 5000;
const NOT_YET_OUT = 5350;
const NOT_YET_REPLY = 5950;
export const LATER_AT = 7000;  // "30 minutes later"
const ASK2_AT = 7500;
export const YES_AT = 9300;
const YES_OUT = 9650;
const NOTED_AT = 10250;
export const CUT_CARE = 12000; // your phone: the caretaker's alert
const CARE_MSG_AT = 12650;
const CARE_HL: [number, number] = [13500, 14300];
export const CARE_TAP_AT = 15500;
const CARE_OUT = 15850;
export const CUT_WHO = 16800;
const CUT_END = 19800;

/* ---------- The product's own text (example person: Lakshmi, the landing page's "Amma") ---------- */

const ASK = (time: string) => `Hi Lakshmi, did you take your ${time} medicine: Thyroxine (50 mcg)?\n\nThis is the medicine check you set up on Aaptha.`;
const NOT_YET_TEXT = 'OK, I’ll ask again at 8:30 AM.';
const NOTED_TEXT = 'Noted: taken at 8:31 AM. ✓';
const CARE_A = 'Medicine alert for Lakshmi: Lakshmi ';
const CARE_HL_TEXT = 'has not confirmed the 1:00 PM medicines (Metformin) after 3 reminders.';
const CARE_B = ' You may want to call Lakshmi on +91 98765 43210.\n\nYou get this as the caretaker named for the medicine checks set up on Aaptha.';

/* ---------- Chat pieces ---------- */

/** A message that opens its own room, so the chat scrolls up as it arrives. */
function Grow({ t, at, side, children }: { t: number; at: number; side?: 'out' | 'chip'; children: React.ReactNode }) {
  if (t < at) return null;
  const room = easeInOut(prog(t, at, at + 380));
  const p = expoOut(prog(t, at + 120, at + 560));
  return (
    <div className={r.grow} style={{ gridTemplateRows: `${room}fr` }}>
      <div className={r.growIn}>
        <div className={r.growBody} data-out={side === 'out' || undefined} data-chip={side === 'chip' || undefined}
          style={{ opacity: p, transform: `translateY(${(1 - p) * 10}px) scale(${0.97 + p * 0.03})`, transformOrigin: side === 'out' ? '100% 100%' : '0 100%' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Btn({ t, at, children }: { t: number; at?: number; children: React.ReactNode }) {
  const tapped = at !== undefined && t >= at;
  const tap = at !== undefined ? prog(t, at, at + 600) : 0;
  return (
    <div className={`${s.waBtn} ${tapped && t < at! + 320 ? r.pressed : ''}`}>
      {tapped && <span className={s.tap} style={{ opacity: (1 - tap) * 0.5, transform: `scale(${0.2 + expoOut(tap) * 1.4})` }} />}
      <Reply /> {children}
    </div>
  );
}

function Out({ text, time }: { text: string; time: string }) {
  return (
    <div className={r.bubble} data-out>
      {text}
      <span className={s.waTime}>{time}<span className={r.ticks}><CheckCheck /></span></span>
    </div>
  );
}

function In({ text, time }: { text: string; time: string }) {
  return <div className={r.bubble}>{text}<span className={s.waTime}>{time}</span></div>;
}

function Ask({ t, time, tapYes, tapNo }: { t: number; time: string; tapYes?: number; tapNo?: number }) {
  return (
    <div className={s.waMsg} style={{ width: '86%' }}>
      <div className={s.waBody}>{ASK(time)}<span className={s.waTime}>{time}</span></div>
      <Btn t={t} at={tapYes}>Yes, taken</Btn>
      <Btn t={t} at={tapNo}>Not yet</Btn>
    </div>
  );
}

function WaScreen({ time, children }: { time: string; children: React.ReactNode }) {
  return (
    <div className={c.screen} style={{ background: '#efe7dd', color: '#111b21' }}>
      <StatusBar time={time} color="#111b21" />
      <div className={c.island} data-mode="idle"><span className={c.lens} /></div>
      <div className={s.wa}>
        <div className={s.waTop}>
          <div className={s.waHead}>
            <ChevronLeft className={s.waBack} />
            <span className={s.waAvatar}><Heart fill="currentColor" strokeWidth={0} /></span>
            <span className={s.waName}>Aaptha</span>
            <Video className={s.waIcon} />
            <Phone className={s.waIcon} />
          </div>
        </div>
        <div className={r.chat}>{children}</div>
        <div className={s.waInput}>
          <Plus />
          <span className={s.waField} />
          <Camera />
          <Mic />
        </div>
      </div>
      <span className={c.homeBar} style={{ background: '#111b21' }} />
    </div>
  );
}

/* ---------- Cameras (the launch film; the landing passes `still`) ---------- */

const CHAT_CAM: Cam = { x: 180 - (DW / 2) * 1.36, y: 640 - DH * 1.36 + 22, s: 1.36 };

function camPerson(t: number): Cam {
  const start = centred(180, 388, 1);
  const pushed = centred(180, 388, 1.05);
  if (t < 2500) return mixCam(start, pushed, easeInOut(prog(t, 0, 2500)));
  const cam = mixCam(pushed, CHAT_CAM, easeInOut(prog(t, 2500, 3600)));
  return { ...cam, y: cam.y - prog(t, 3600, CUT_CARE) * 6 };
}

function camCaretaker(t: number): Cam {
  const enter = expoOut(prog(t, CUT_CARE + 100, CUT_CARE + 850));
  return { ...CHAT_CAM, y: CHAT_CAM.y + (1 - enter) * 380 - prog(t, CUT_CARE + 850, CUT_WHO) * 6 };
}

/* ---------- The person's phone: lock screen, then the chat ---------- */

/** Lakshmi's phone: the medicine check, "Not yet", asked again, "Yes, taken". */
export function PersonPhone({ t, still }: { t: number; still?: Cam }) {
  // Leaves as your phone arrives (the landing's still phone fades in place; the film lifts it away).
  const out = easeIn(prog(t, CUT_CARE - 450, CUT_CARE - 50));
  if (out >= 1) return null;
  const lock = !still && t < CHAT_AT + 200;
  const toChat = still ? 1 : easeInOut(prog(t, CHAT_AT - 300, CHAT_AT + 200));
  const notif = expoOut(prog(t, NOTIF_AT, NOTIF_AT + 600));
  const tap = prog(t, NOTIF_TAP, NOTIF_TAP + 500);

  return (
    <Shell cam={still ?? camPerson(t)} style={{ opacity: 1 - out, translate: `0 ${-out * (still ? 20 : 90)}px` }}>
      <WaScreen time={t < LATER_AT ? '8:00' : '8:31'}>
        <Grow t={t} at={0} side="chip"><span className={s.waDate}>Today</span></Grow>
        <Grow t={t} at={still ? 0 : ASK1_AT}><Ask t={t} time="8:00 AM" tapNo={NOT_YET_AT} /></Grow>
        <Grow t={t} at={NOT_YET_OUT} side="out"><Out text="Not yet" time="8:00 AM" /></Grow>
        <Grow t={t} at={NOT_YET_REPLY}><In text={NOT_YET_TEXT} time="8:00 AM" /></Grow>
        <Grow t={t} at={LATER_AT} side="chip"><span className={s.waDate}>30 minutes later</span></Grow>
        <Grow t={t} at={ASK2_AT}><Ask t={t} time="8:30 AM" tapYes={YES_AT} /></Grow>
        <Grow t={t} at={YES_OUT} side="out"><Out text="Yes, taken" time="8:31 AM" /></Grow>
        <Grow t={t} at={NOTED_AT}><In text={NOTED_TEXT} time="8:31 AM" /></Grow>
      </WaScreen>

      {lock && (
        <div className={c.screen} style={{ opacity: 1 - toChat }}>
          <div className={r.lock}>
            <StatusBar time="" color="#fff" />
            <span className={r.lockDate}>Monday 12 October</span>
            <span className={r.lockTime}>8:00</span>
            <div className={r.notif} style={{ opacity: notif, transform: `translateY(${(1 - notif) * -30}px) scale(${0.94 + notif * 0.06 + (t >= NOTIF_TAP ? Math.sin(tap * Math.PI) * -0.02 : 0)})` }}>
              <span className={r.notifIcon}><MessageCircle fill="currentColor" strokeWidth={0} /></span>
              <span className={r.notifText}>
                <span className={r.notifTop}>Aaptha <small>now</small></span>
                Hi Lakshmi, did you take your 8:00 AM medicine: Thyroxine (50 mcg)?
              </span>
              {t >= NOTIF_TAP && <span className={r.notifTap} style={{ opacity: Math.sin(tap * Math.PI) }} />}
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

/** Your phone, as the caretaker: the alert when a dose isn't confirmed, and "I'll handle it". */
export function CaretakerPhone({ t, still }: { t: number; still?: Cam }) {
  if (t < CUT_CARE) return null;
  const out = still ? 0 : easeIn(prog(t, CUT_WHO - 450, CUT_WHO - 50));
  const enter = expoOut(prog(t, CUT_CARE + 100, CUT_CARE + 850));
  const hl = easeInOut(prog(t, CARE_HL[0], CARE_HL[1]));
  return (
    <Shell
      cam={still ?? camCaretaker(t)}
      style={still ? { opacity: enter, translate: `0 ${(1 - enter) * 40}px` } : { opacity: 1 - out, translate: `0 ${out * 90}px` }}
    >
      <WaScreen time="2:30">
        <Grow t={t} at={0} side="chip"><span className={s.waDate}>Today</span></Grow>
        <Grow t={t} at={CARE_MSG_AT}>
          <div className={s.waMsg} style={{ width: '88%' }}>
            <div className={s.waBody}>
              {CARE_A}
              <mark className={s.hl} style={{ backgroundSize: `${hl * 100}% 100%` }}>{CARE_HL_TEXT}</mark>
              {CARE_B}
              <span className={s.waTime}>2:30 PM</span>
            </div>
            <Btn t={t} at={CARE_TAP_AT}>I’ll handle it</Btn>
          </div>
        </Grow>
        <Grow t={t} at={CARE_OUT} side="out"><Out text="I’ll handle it" time="2:30 PM" /></Grow>
      </WaScreen>
    </Shell>
  );
}

/* ---------- Film-only scenes ---------- */

const WHO = ['For yourself', 'For Amma or Appa', 'For a working mum-to-be', 'For a student on a course'];

function Who({ t }: { t: number }) {
  if (t < CUT_WHO - 100 || t > CUT_END + 200) return null;
  const out = easeIn(prog(t, CUT_END - 350, CUT_END));
  return (
    <div className={s.langs} style={{ opacity: 1 - out, transform: `translateY(${-out * 18}px)` }}>
      <h2 className={s.langTitle} style={inOut(t, CUT_WHO + 120, CUT_END + 1000, 600, 18)}>Anyone on medicines.</h2>
      <p className={s.langSub} style={inOut(t, CUT_WHO + 320, CUT_END + 1000, 600, 12)}>Up to {PLANS.essential.remindersPerDay} times a day. Stops when the course ends.</p>
      <div className={r.whoGrid}>
        {WHO.map((w, i) => {
          const p = expoOut(prog(t, CUT_WHO + 600 + i * 220, CUT_WHO + 1200 + i * 220));
          return <div key={w} className={r.whoCard} style={{ opacity: p, transform: `translateY(${(1 - p) * 16}px) scale(${0.94 + p * 0.06})` }}>{w}</div>;
        })}
      </div>
    </div>
  );
}

function Outro({ t }: { t: number }) {
  if (t < CUT_END - 100) return null;
  const line = (i: number) => inOut(t, CUT_END + 250 + i * 130, R_DURATION + 5000, 700, 16);
  const plan = PLANS.essential;
  return (
    <div className={s.outro}>
      <div className={s.brand} style={{ ...inOut(t, CUT_END + 50, R_DURATION + 5000, 700, 12), display: 'flex', width: '100%' }}>
        <span className={s.brandHeart}><Heart fill="white" strokeWidth={0} /></span>
        <span className={s.brandWord}>Aaptha</span>
        <span className={r.planPill}>{plan.name}</span>
      </div>
      <h1 className={s.outroH1}>
        <span style={line(0)}>Medicine reminders</span>
        <span style={line(1)}><em>on WhatsApp.</em></span>
      </h1>
      <div className={r.price} style={inOut(t, CUT_END + 800, R_DURATION + 5000, 700, 14)}>
        <b>₹{plan.priceMonthly}</b>
        <span>a month</span>
        {plan.listPrice && <s>₹{plan.listPrice}</s>}
      </div>
      <p className={s.tagline} style={inOut(t, CUT_END + 1150, R_DURATION + 5000, 700, 10)}>
        <span className={s.ring} />{plan.trialDays} days free · no calls · no app to install
      </p>
    </div>
  );
}

/* ---------- The film ---------- */

const CAPTIONS: { from: number; to: number; node: React.ReactNode }[] = [
  { from: -400, to: CHAT_AT - 100, node: <>At medicine time, a <span>WhatsApp</span>.</> },
  { from: CHAT_AT + 200, to: LATER_AT - 150, node: <>One tap: <span>Yes, taken</span> or Not yet.</> },
  { from: LATER_AT + 50, to: CUT_CARE - 150, node: <>Not yet? Asked again in <span>30 minutes</span>.</> },
  { from: CUT_CARE + 250, to: CUT_WHO - 250, node: <>Still not taken? <span>You</span> get told.</> },
];

export function RemindFilm() {
  const [t, setT] = useState(0);

  useEffect(() => {
    const q = Number(new URLSearchParams(window.location.search).get('t'));
    window.__brag = {
      duration: R_DURATION,
      seek: (ms: number) => new Promise<void>((resolve) => {
        flushSync(() => setT(ms));
        syncAnimations(ms);
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
    };
    if (q) {
      let at = Math.max(0, q - 1500);
      const step = () => {
        flushSync(() => setT(at));
        syncAnimations(at);
        if (at < q) { at = Math.min(q, at + 1000 / 30); requestAnimationFrame(step); }
      };
      step();
    } else {
      syncAnimations(0);
    }
  }, []);

  const bgDrift = t / R_DURATION;
  const cap = CAPTIONS.find((k) => t >= k.from && t < k.to + 400);
  return (
    <div className={s.film}>
      <style>{'nextjs-portal{display:none!important}'}</style>
      <div className={s.bg} style={{ transform: `translate(${bgDrift * -14}px, ${bgDrift * 22}px)` }} />

      <PersonPhone t={t} />
      <CaretakerPhone t={t} />

      <div className={s.capWrap} style={{ height: t < CHAT_AT ? 150 : 178, opacity: t < CUT_WHO ? 1 : 0 }}>
        {cap && <p className={s.caption} style={inOut(t, cap.from, cap.to, 450, 14)}>{cap.node}</p>}
      </div>

      <Who t={t} />
      <Outro t={t} />
    </div>
  );
}
