'use client';

import { useEffect, useRef, useState } from 'react';
import { ReactLenis, type LenisRef } from 'lenis/react';
import type Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import 'lenis/dist/lenis.css';

gsap.registerPlugin(ScrollTrigger);

/**
 * Landing-page smooth scrolling (Lenis), ticked by GSAP's clock so the scroll-driven scenes (GsapScroll)
 * move in step with it instead of a frame behind. Off for people who ask the OS for less motion;
 * in-page # links still glide.
 */
export function SmoothScroll() {
  const [on, setOn] = useState(false);
  const lenisRef = useRef<LenisRef>(null);

  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setOn(!q.matches);
    sync();
    q.addEventListener('change', sync);
    return () => q.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!on) return;
    // ReactLenis creates its instance a render later, so pick it up on the first tick that has it.
    let bound: Lenis | undefined;
    let unbind = () => {};
    const tick = (time: number) => {
      const lenis = lenisRef.current?.lenis;
      if (!lenis) return;
      if (lenis !== bound) {
        unbind();
        unbind = lenis.on('scroll', ScrollTrigger.update);
        bound = lenis;
      }
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(tick);
      unbind();
      gsap.ticker.lagSmoothing(500, 33);
    };
  }, [on]);

  return on ? <ReactLenis root ref={lenisRef} options={{ anchors: true, autoRaf: false }} /> : null;
}
