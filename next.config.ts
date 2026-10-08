import type { NextConfig } from "next";

/**
 * Browser hardening for pages and API responses (medical data lives here).
 * No full Content-Security-Policy yet: Razorpay Checkout and Google Sign-In inject scripts and frames, so a
 * strict CSP needs a nonce setup and a test pass against both. `frame-ancestors` is safe on its own and stops
 * the app being framed (clickjacking); X-Frame-Options covers older browsers.
 */
const securityHeaders = [
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
