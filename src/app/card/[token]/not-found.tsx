/**
 * An emergency card link that no longer works (turned off, replaced by a new link, or mistyped).
 * Whoever opens it may be a neighbour or a hospital, so the emergency numbers come first.
 */
export default function CardNotFound() {
  return (
    <main style={{ padding: '32px 16px 64px', minHeight: '100vh', background: 'var(--paper)' }}>
      <article className="card-sheet">
        <h1>This emergency card is no longer active</h1>
        <div className="sos">
          In an emergency call <a href="tel:112" style={{ color: 'inherit' }}>112</a> (ambulance{' '}
          <a href="tel:108" style={{ color: 'inherit' }}>108</a>).
        </div>
        <p style={{ marginTop: '18px', color: 'var(--ink-muted)' }}>
          The family may have turned this link off or made a new one. Please ask them for the latest card.
        </p>
      </article>
    </main>
  );
}
