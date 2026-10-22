import { notFound } from 'next/navigation';
import { ThinkingOrb } from '@/components/ui/ThinkingOrb';

const STATES = ['working', 'searching', 'solving', 'listening', 'connecting', 'weaving', 'composing', 'breathing', 'shaping'] as const;

// Every thinking-orb state, plus the places the app uses them. Only exists under `next dev`.
export default function ThinkingOrbsDevPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return (
    <main className="container" style={{ padding: '40px 16px', display: 'grid', gap: '24px' }}>
      <section className="panel">
        <h3>All states</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', color: 'var(--teal)' }}>
          {STATES.map(s => (
            <div key={s} style={{ display: 'grid', justifyItems: 'center', gap: '6px' }}>
              <ThinkingOrb state={s} size={64} />
              <ThinkingOrb state={s} size={20} />
              <small style={{ color: 'var(--ink-muted)' }}>{s}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="panel" style={{ display: 'grid', gap: '16px' }}>
        <h3>In the app</h3>
        <div className="ask-log"><div className="ask-bubble ai ask-thinking"><ThinkingOrb state="composing" size={32} style={{ color: 'var(--teal)' }} /><span>Going through Amma&apos;s calls…</span></div></div>
        <div className="dropzone" style={{ borderStyle: 'solid', borderColor: 'var(--teal)', background: 'var(--teal-light)' }}>
          <ThinkingOrb state="searching" size={64} style={{ display: 'flex', margin: '0 auto 14px', color: 'var(--teal)' }} />
          <div style={{ fontWeight: 600 }}>Reading the prescription…</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          <span className="status-orb live"><ThinkingOrb state="listening" size={32} /></span>
          <span style={{ color: 'var(--ink-muted)' }}>Call in progress (call history)</span>
        </div>
      </section>
    </main>
  );
}
