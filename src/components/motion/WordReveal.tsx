'use client';

import React from 'react';
import { motion } from 'motion/react';

/**
 * Headline whose words rise into place one after another when it scrolls into view.
 * Pass plain strings or <span>s (e.g. a gradient accent) as children; each child is split on spaces.
 */
export function WordReveal({ children, className, as = 'h2', delay = 0, onLoad = false }: { children: React.ReactNode; className?: string; as?: 'h1' | 'h2' | 'h3'; delay?: number; onLoad?: boolean }) {
  const Tag = motion[as];
  const words: React.ReactNode[] = [];
  React.Children.forEach(children, (child, ci) => {
    if (typeof child === 'string') {
      child.split(/(\s+)/).forEach((w, wi) => {
        if (!w) return;
        words.push(/^\s+$/.test(w) ? ' ' : <Word key={`${ci}-${wi}`}>{w}</Word>);
      });
    } else if (React.isValidElement(child) && child.type === 'br') {
      words.push(child);
    } else if (child != null) {
      words.push(<Word key={`${ci}-el`}>{child}</Word>);
    }
  });

  return (
    <Tag
      className={className}
      initial="hidden"
      {...(onLoad ? { animate: 'show' } : { whileInView: 'show', viewport: { once: true, margin: '0px 0px -12% 0px' } })}
      transition={{ staggerChildren: 0.06, delayChildren: delay }}
    >
      {words}
    </Tag>
  );
}

function Word({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', paddingBottom: '0.12em', marginBottom: '-0.12em' }}>
      <motion.span
        style={{ display: 'inline-block' }}
        variants={{
          hidden: { y: '105%', opacity: 0 },
          show: { y: 0, opacity: 1, transition: { type: 'spring', stiffness: 260, damping: 26 } },
        }}
      >
        {children}
      </motion.span>
    </span>
  );
}
