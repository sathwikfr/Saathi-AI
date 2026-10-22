import type { NextConfig } from "next";

const dev = process.env.NODE_ENV === "development";

/**
 * The full Content-Security-Policy, in REPORT-ONLY mode (2026-10-22): browsers block nothing, they only
 * report what this would have blocked to /api/csp-report (Vercel logs, "[csp]"). Once a week of real use
 * (incl. a Razorpay checkout and a Google sign-in) reports nothing, move these directives into the enforced
 * Content-Security-Policy below.
 * The only outside origins the browser loads from: Google Identity Services (sign-in button) and Razorpay
 * Checkout. Everything else (Sarvam, Groq, Meta, Open-Meteo, Supabase) is called from the server.
 * ponytail: scripts allow 'unsafe-inline' (Next's inline bootstrap + the theme script); nonces would remove
 * that but make every page dynamic. Add them if an XSS ever matters more than static pages.
 */
const reportOnlyCsp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""} https://accounts.google.com/gsi/client https://checkout.razorpay.com`,
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "img-src 'self' data: blob: https://cdn.razorpay.com",
  "font-src 'self' data:",
  `connect-src 'self' https://accounts.google.com/gsi/ https://api.razorpay.com https://lumberjack.razorpay.com${dev ? " ws: wss:" : ""}`,
  "frame-src https://accounts.google.com/gsi/ https://api.razorpay.com https://checkout.razorpay.com",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "report-uri /api/csp-report"
].join("; ");

/**
 * Browser hardening for pages and API responses (medical data lives here).
 * `frame-ancestors` stops the app being framed (clickjacking); X-Frame-Options covers older browsers.
 */
const securityHeaders = [
  { key: "Content-Security-Policy-Report-Only", value: reportOnlyCsp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(self)" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      // Signed-in API answers are never cached by a browser or a proxy.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] }
    ];
  }
};

export default nextConfig;
