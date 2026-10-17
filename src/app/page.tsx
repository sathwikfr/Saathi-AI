'use client';

import React from 'react';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { Reveal } from '@/components/Reveal';
import { VoiceHero } from '@/components/landing/VoiceHero';
import { HowFilm } from '@/components/landing/HowFilm';
import { SetupSteps } from '@/components/landing/SetupSteps';
import { LanguagesSection } from '@/components/landing/LanguagesSection';
import { AfterCallSection } from '@/components/landing/AfterCallSection';
import { SafetySection } from '@/components/landing/SafetySection';
import { CompareSection } from '@/components/landing/CompareSection';
import { PricingSection } from '@/components/landing/PricingSection';
import { FaqSection } from '@/components/landing/FaqSection';
import { FinalCta } from '@/components/landing/FinalCta';
import { ScrollProgress } from '@/components/motion/ScrollProgress';
import { SmoothScroll } from '@/components/motion/SmoothScroll';
import { GsapScroll } from '@/components/motion/GsapScroll';
import { WordReveal } from '@/components/motion/WordReveal';
import s from '@/components/landing/home.module.css';
import { FREE_TRIAL_DAYS } from '@/lib/plans';
import { PlanId } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';

export default function LandingPage() {
  const { user } = useAuth();

  const getPlanLink = (planId: PlanId) => (user ? `/checkout/confirm?plan=${planId}` : `/signup?plan=${planId}`);
  const primaryHref = user ? '/dashboard' : '/signup';
  const primaryLabel = user ? 'Go to your dashboard' : 'Start free trial';

  return (
    <>
      <ScrollProgress />
      <SmoothScroll />
      <GsapScroll />
      <Navbar />

      <main id="main">
        {/* HERO */}
        <VoiceHero primaryHref={primaryHref} primaryLabel={primaryLabel} trialDays={FREE_TRIAL_DAYS} />

        {/* HOW IT WORKS: a film the scroll plays (the self-playing phone demo with reduced motion) */}
        <HowFilm />

        {/* AFTER EVERY CALL: the dashboard and WhatsApp, side by side */}
        <AfterCallSection />

        {/* SET IT UP ONCE */}
        <section className={`section ${s.alt}`}>
          <div className="wrap">
            <Reveal className={s.head}>
              <WordReveal>Set it up once. <span className={s.grad}>Saathi does the rest.</span></WordReveal>
              <p>A few minutes to set up. After that, Saathi calls on time and you see how every call went.</p>
            </Reveal>
            <Reveal delay={120}>
              <SetupSteps />
            </Reveal>
          </div>
        </section>

        {/* LANGUAGES: a greeting in each of the nine */}
        <LanguagesSection />

        {/* SAFETY: four promises, each shown in action */}
        <SafetySection />

        {/* COMPARE (the nav's "Why a phone call" lands here) */}
        <CompareSection />

        {/* PRICING */}
        <PricingSection planHref={getPlanLink} />

        {/* FAQ */}
        <FaqSection />

        {/* CLOSING: one last call to action, on the fog */}
        <FinalCta primaryHref={primaryHref} primaryLabel={primaryLabel} trialDays={FREE_TRIAL_DAYS} />

      </main>

      <Footer />
    </>
  );
}
