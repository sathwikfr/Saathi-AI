import Link from 'next/link';
import { Compass } from 'lucide-react';
import { Navbar } from '@/components/Navbar';

/** Any unknown address: the brand's own 404 instead of Next's plain one. */
export default function NotFound() {
  return (
    <>
      <Navbar />
      <main id="main" className="wrap-narrow" style={{ padding: '56px 16px 96px' }}>
        <div className="panel empty" style={{ maxWidth: '520px', margin: '0 auto', padding: '40px 28px' }}>
          <span className="icon-tile"><Compass size={24} /></span>
          <h1 style={{ fontSize: '1.5rem', letterSpacing: '-0.02em', marginBottom: '8px' }}>We couldn&apos;t find that page</h1>
          <p>The link may be old or mistyped.</p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '22px' }}>
            <Link href="/" className="btn btn-primary">Go to the home page</Link>
            <Link href="/dashboard" className="btn btn-ghost">Open the dashboard</Link>
          </div>
        </div>
      </main>
    </>
  );
}
