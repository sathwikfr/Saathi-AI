'use client';

import React, { useEffect, useRef } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { useReducedMotion } from 'motion/react';
import { SafetyFilm, SAFETY_FILM } from './SafetyFilm';

/**
 * Plays the safety film like a muted, looping video while it is on screen and pauses it off screen.
 * With reduced motion it shows one still frame (the calm ending). Loaded lazily by SafetySection.
 */
export default function SafetyFilmPlayer() {
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const player = useRef<PlayerRef>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || reduce) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) player.current?.play();
      else player.current?.pause();
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [reduce]);

  return (
    <div ref={box} style={{ width: '100%', height: '100%' }}>
      <Player
        ref={player}
        component={SafetyFilm}
        durationInFrames={SAFETY_FILM.durationInFrames}
        fps={SAFETY_FILM.fps}
        compositionWidth={SAFETY_FILM.width}
        compositionHeight={SAFETY_FILM.height}
        style={{ width: '100%', height: '100%' }}
        initialFrame={reduce ? 400 : 0}
        loop
        initiallyMuted
        controls={false}
        clickToPlay={false}
        doubleClickToFullscreen={false}
        spaceKeyToPlayOrPause={false}
        acknowledgeRemotionLicense
      />
    </div>
  );
}
