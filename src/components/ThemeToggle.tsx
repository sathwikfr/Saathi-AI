'use client';

import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { THEME_BAR, THEME_STORAGE_KEY } from '@/lib/theme';

function toggleTheme() {
  const root = document.documentElement;
  const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_BAR[next]);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // storage unavailable (private mode); the choice lasts for this page only
  }
}

/** Light/dark switch. The icon is chosen in CSS from data-theme, so SSR and client markup match. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  return (
    <button type="button" onClick={toggleTheme} className={`btn btn-quiet btn-icon theme-toggle ${className}`} aria-label="Switch between light and dark mode">
      <Moon size={17} className="icon-moon" />
      <Sun size={17} className="icon-sun" />
    </button>
  );
}
