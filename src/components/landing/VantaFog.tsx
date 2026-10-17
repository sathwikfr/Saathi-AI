'use client';

import React, { useEffect, useRef } from 'react';

/**
 * A slow fog of the orb's colours (blue, violet, magenta) over the film navy, drawn by Vanta.js. three.js
 * and Vanta (~150 KB gzipped) load only when this comes within a screen of view, and the effect is
 * destroyed when it unmounts (Vanta itself skips frames while it is off screen). Not drawn with reduced
 * motion, below 768px wide, or when WebGL fails: the CSS gradient on the element underneath shows instead.
 */
export function VantaFog({ className }: { className?: string }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce), (max-width: 767px)').matches) return;

    let effect: { destroy(): void } | undefined;
    let gone = false;
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      try {
        const [THREE, mod] = await Promise.all([import('three'), import('vanta/dist/vanta.fog.min')]);
        if (gone) return;
        // The file is UMD: depending on the bundler the function sits on .default or .default.default.
        const m = mod as unknown as { default: { default?: typeof mod.default } & typeof mod.default };
        const FOG = m.default.default ?? m.default;
        effect = FOG({
          el: node,
          THREE,
          mouseControls: false,
          touchControls: false,
          gyroControls: false,
          minHeight: 200,
          minWidth: 200,
          highlightColor: 0x5b8cff,   // orb blue
          midtoneColor: 0x7a3cff,     // orb violet
          lowlightColor: 0xd03a9e,    // orb magenta
          baseColor: 0x010d16,        // --band-2
          blurFactor: 0.62,
          speed: 0.7,
          zoom: 0.8,
        });
      } catch (err) {
        console.warn('[fog] Not drawn:', err);
      }
    }, { rootMargin: '600px 0px' });
    io.observe(node);

    return () => {
      gone = true;
      io.disconnect();
      effect?.destroy();
    };
  }, []);

  return <div ref={el} className={className} aria-hidden="true" />;
}
