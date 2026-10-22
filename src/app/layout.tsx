import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Figtree } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import { MotionProvider } from '@/components/motion/MotionProvider';

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  axes: ['opsz'],
});

const body = Figtree({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Aaptha — Did Amma take her BP tablet? Now you’ll know.',
  description: 'Saathi calls your parents at every tablet time, in their own language, and sends you the answer on WhatsApp. No app for them, no nagging from you.',
  keywords: ['aaptha', 'elder care', 'ai voice companion', 'parents check-in', 'medication reminder', 'india elder care']
};

export const viewport: Viewport = {
  themeColor: '#f8f5ef',          // the site opens light whatever the device setting (lib/theme.ts)
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="light" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        <AuthProvider>
          <MotionProvider>{children}</MotionProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
