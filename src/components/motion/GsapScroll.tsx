'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * The landing's one place for scroll-driven scenes. Renders nothing; mount once on the page.
 *  - The navbar takes a dark scene's colours while a `.stage-dark` is what sits right under it
 *    (`data-stage="on"|"off"` on the header). A hit test, not one trigger per scene, so light sheets
 *    sliding over a held scene switch it back at exactly their edge.
 *  - Hero hand-off (wide screens): as the hero scrolls away, the camera pushes into the orb (it grows and
 *    fades) while the pitch and the call column part to the sides and the promises drop away.
 *    Below 1100px the hero stacks, so it is left alone there.
 *  - Depth (wide screens): `data-speed` parallax and `data-grow` grow-in, scrubbed with the scroll.
 *  - `data-stagger` lists arrive item by item (`data-pop` marks inside pop after); `data-spot` cards get a
 *    pointer-following light.
 * Scene motion is skipped when the visitor prefers reduced motion; the navbar colours always follow.
 */
export function GsapScroll() {
  useGSAP(() => {
    const header = document.querySelector('header.app-header');
    // The hit test needs a laid-out page, so it runs at most once a frame, in the frame's own layout.
    // (Run straight from hydration or from every scroll event, it forced extra full-page layouts: 1.6 s on a slow phone.)
    let queued = 0;
    const syncHeader = () => {
      if (queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        // The header is 68px tall: look at what is just under its bottom edge.
        // Only full-width scenes count: a dark card inside a light section (the closing CTA) leaves the bar alone.
        const scene = document.elementFromPoint(window.innerWidth / 2, 69)?.closest('.stage-dark');
        header?.setAttribute('data-stage', scene && scene.clientWidth >= window.innerWidth * 0.98 ? 'on' : 'off');
      });
    };
    syncHeader();
    window.addEventListener('scroll', syncHeader, { passive: true });
    window.addEventListener('resize', syncHeader);

    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference) and (min-width: 1100px)', () => {
      const hero = document.querySelector('[data-scene="hero"]');
      if (!hero) return;
      // Dolly and split: the camera pushes into the orb while the two columns part to the sides.
      const q = (sel: string) => hero.querySelector(sel);
      gsap.timeline({ scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.6 } })
        .to(q('[data-hero-orb]'), { scale: 1.32, autoAlpha: 0, ease: 'power1.in' }, 0)
        .to(q('[data-hero-copy]'), { x: -140, autoAlpha: 0, ease: 'power1.in' }, 0)
        .to(q('[data-hero-side]'), { x: 140, autoAlpha: 0, ease: 'power1.in' }, 0);

      // Depth: [data-speed] drifts against the scroll (±speed × 100px across the screen), [data-grow] grows in.
      gsap.utils.toArray<HTMLElement>('[data-speed]').forEach((el) => {
        const d = Number(el.dataset.speed) * 100;
        gsap.fromTo(el, { '--py': `${d}px` }, {
          '--py': `${-d}px`, ease: 'none',
          scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true },
        });
      });
      gsap.utils.toArray<HTMLElement>('[data-grow]').forEach((el) => {
        gsap.fromTo(el, { '--grow': 0.86 }, {
          '--grow': 1, ease: 'none',
          scrollTrigger: { trigger: el, start: 'top bottom', end: 'top 30%', scrub: true },
        });
      });

      // Sections below the fold get their real height only when first drawn (content-visibility), so the
      // trigger positions are measured again whenever the page's height changes.
      let refresh = 0;
      const ro = new ResizeObserver(() => {
        clearTimeout(refresh);
        refresh = window.setTimeout(() => ScrollTrigger.refresh(), 200);
      });
      ro.observe(document.body);
      return () => {
        ro.disconnect();
        clearTimeout(refresh);
      };
    });

    // Lists that arrive one item at a time ([data-stagger]); marks inside them ([data-pop]) pop in after.
    // CSS transitions started by an IntersectionObserver (styles in globals.css, "Stagger lists"). GSAP tweens
    // here read each item's computed style between writes, which re-styled the whole page once per item.
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const lists = gsap.utils.toArray<HTMLElement>('[data-stagger]');
      lists.forEach((el) => {
        [...el.children].forEach((c, i) => (c as HTMLElement).style.setProperty('--i', String(i)));
        el.querySelectorAll<HTMLElement>('[data-pop]').forEach((c, i) => c.style.setProperty('--pi', String(i)));
      });
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      }, { rootMargin: '0px 0px -15% 0px' });   // = the old "top 85%" start
      lists.forEach((el) => io.observe(el));
      document.documentElement.classList.add('stagger-ready');
      return () => {
        io.disconnect();
        document.documentElement.classList.remove('stagger-ready');
        lists.forEach((el) => el.classList.remove('in'));
      };
    });

    // A soft light that follows the pointer across [data-spot] cards (--mx/--my, drawn by each card's CSS).
    const spot = (e: PointerEvent) => {
      const card = (e.target as Element | null)?.closest?.('[data-spot]') as HTMLElement | null;
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    };
    window.addEventListener('pointermove', spot, { passive: true });

    return () => {
      cancelAnimationFrame(queued);
      window.removeEventListener('pointermove', spot);
      window.removeEventListener('scroll', syncHeader);
      window.removeEventListener('resize', syncHeader);
      header?.removeAttribute('data-stage');
    };
  });
  return null;
}
