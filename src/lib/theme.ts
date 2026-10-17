export const THEME_STORAGE_KEY = 'cc-theme';

/**
 * Inline <head> script: applies the saved theme (set by the toggle), otherwise light, before first
 * paint so there is no flash. The site opens light even when the device is in dark mode (user, 2026-10-17).
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t!=="light"&&t!=="dark"){t="light"}document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
