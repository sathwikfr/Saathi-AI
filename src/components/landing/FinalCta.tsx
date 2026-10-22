'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight, Heart, CircleCheck } from 'lucide-react';
import { MagneticLink } from '@/components/motion/MagneticLink';
import { WordReveal } from '@/components/motion/WordReveal';
import { Reveal } from '@/components/Reveal';
import s from './finalCta.module.css';

/**
 * The closing scene of the landing page: a dark film card on a slow Vanta fog in the orb's colours
 * (a still gradient when the fog isn't drawn), with a heart disc and a slow ring, the headline, two
 * buttons and three proof points. The card is a .stage-dark, so its text takes the dark tokens in
 * both site themes.
 */

export function FinalCta({ primaryHref, primaryLabel, trialDays }: { primaryHref: string; primaryLabel: string; trialDays: number }) {
  return (
    <section id="start" className="section">
      <div className="wrap">
        <Reveal variant="scale" className={`${s.card} stage-dark`}>
          <span className={s.icon} aria-hidden="true"><Heart size={26} fill="currentColor" strokeWidth={0} /></span>
          <WordReveal className={s.title}>Set it up tonight. <span className={s.accent}>Saathi calls tomorrow.</span></WordReveal>
          <p className={s.text}>
            A few minutes to add your parent and their medicines. Every plan starts with {trialDays} days free, and you can cancel any time.
          </p>

          <div className={s.ctas}>
            <MagneticLink href={primaryHref} className={s.solid}>{primaryLabel} <ArrowRight size={18} /></MagneticLink>
            <Link href="#plans" className={s.ghost}>See the plans</Link>
          </div>

          <ul className={s.proof}>
            <li><CircleCheck size={17} aria-hidden="true" />{trialDays}-day free trial</li>
            <li><CircleCheck size={17} aria-hidden="true" />No app for your parents</li>
            <li><CircleCheck size={17} aria-hidden="true" />Works in 9 Indian languages</li>
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
