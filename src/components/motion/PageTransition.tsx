'use client';

import React, { ViewTransition } from 'react';

/**
 * Wraps a page's content so route changes animate (React <ViewTransition>, CSS in globals.css):
 * the old page fades out, the new one settles in; links tagged `transitionTypes={['nav-forward']}` /
 * `['nav-back']` (checkout steps) slide instead. Put it in a page or a page's shell, never a layout:
 * layouts persist across navigations, so nothing would enter or leave there.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const kinds = { 'nav-forward': 'nav-forward', 'nav-back': 'nav-back', default: 'page' };
  return (
    <ViewTransition enter={kinds} exit={kinds} default="none">
      {children}
    </ViewTransition>
  );
}
