import React from 'react';
import { UserRound, Pill, Clock, BellRing } from 'lucide-react';
import c from './liveCallPhone.module.css';

/**
 * "Set it up once": the three things a family does at signup (the same order as
 * the onboarding wizard), then Saathi takes over. Sits between the "How it works"
 * heading and the phone, which shows the "does the rest" part. Covers both ways in: calls (the
 * calling plans) and WhatsApp checks (Remind), which can be for the person themself.
 */
const STEPS = [
  { icon: UserRound, title: 'Add your parent', note: 'Or yourself: name, number, language' },
  { icon: Pill, title: 'Add the medicines', note: 'In your own words, no prescription needed' },
  { icon: Clock, title: 'Pick the times', note: 'A call or a WhatsApp, morning to bedtime' },
];

export function SetupSteps() {
  return (
    <ol className={c.setup} aria-label="Setting up">
      {STEPS.map((st, i) => (
        <li key={st.title} className={c.setupStep}>
          <span className={c.setupIcon}><st.icon size={17} /></span>
          <span className={c.setupText}>
            <b><span className={c.setupNum}>{i + 1}</span>{st.title}</b>
            <small>{st.note}</small>
          </span>
        </li>
      ))}
      <li className={`${c.setupStep} ${c.setupDone}`}>
        <span className={c.setupIcon}><BellRing size={17} /></span>
        <span className={c.setupText}>
          <b>Aaptha takes over</b>
          <small>Calls or WhatsApp checks, on time</small>
        </span>
      </li>
    </ol>
  );
}
