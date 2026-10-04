import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NOTICES, NOTICE_LANGS, isNoticeLang } from '@/lib/parentNotices';

export const metadata: Metadata = {
  title: 'About Saathi — Aaptha',
  description: 'A short note for parents: what Saathi is, what your family sees, and how to stop the calls.'
};

export function generateStaticParams() {
  return NOTICE_LANGS.map(lang => ({ lang }));
}

/**
 * The short privacy notice written for the PARENT, in their language. Families share it on
 * WhatsApp from the dashboard. Large, plain text; no account needed.
 */
export default async function ParentNoticePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isNoticeLang(lang)) notFound();
  const n = NOTICES[lang];
  const support = process.env.NEXT_PUBLIC_SUPPORT_PHONE;

  return (
    <main style={{ padding: '32px 16px 64px', minHeight: '100vh', background: 'var(--paper)' }}>
      <article className="card-sheet" lang={lang}>
        <nav aria-label="Language" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '20px' }}>
          {NOTICE_LANGS.map(l => (
            <Link key={l} href={`/notice/${l}`} className={`chip${l === lang ? ' info' : ''}`} aria-current={l === lang ? 'page' : undefined}>
              {NOTICES[l].label}
            </Link>
          ))}
        </nav>
        <h1>{n.title}</h1>
        <ol style={{ marginTop: '18px', paddingLeft: '22px', display: 'grid', gap: '14px', fontSize: '1.15rem', lineHeight: 1.6 }}>
          {n.lines.map((line, i) => (
            <li key={i} style={i === 5 ? { color: 'var(--red)', fontWeight: 600 } : undefined}>
              {line}
              {i === 4 && support && <> {n.support(support)}</>}
            </li>
          ))}
        </ol>
      </article>
    </main>
  );
}
