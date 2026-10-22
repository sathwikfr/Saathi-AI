export const THEME_STORAGE_KEY = 'cc-theme';

/** The phone browser bar colour per theme (= --paper). */
export const THEME_BAR = { light: '#f8f5ef', dark: '#13120f' } as const;

/**
 * Inline <head> script: applies the saved theme (set by the toggle), otherwise light, before first
 * paint so there is no flash. The site opens light even when the device is in dark mode (user, 2026-10-17).
 */
export const THEME_INIT_SCRIPT = `(function(){var THEME_BAR=${JSON.stringify(THEME_BAR)};try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t!=="light"&&t!=="dark"){t="light"}document.documentElement.setAttribute("data-theme",t);var bar=function(){var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",THEME_BAR[t])};bar();document.addEventListener("DOMContentLoaded",bar)}catch(e){}})()`;
