/**
 * Only allow same-site relative redirects (blocks `//evil.com`, `/\evil.com` and absolute URLs).
 * Backslashes and control characters are refused anywhere: browsers drop tabs/newlines and treat `\` as `/`,
 * so `/\t/evil.com` or `/%5C` tricks would otherwise turn into `//evil.com`.
 */
export function safeRedirectPath(value: string | null | undefined, fallback = '/dashboard'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value;
}
