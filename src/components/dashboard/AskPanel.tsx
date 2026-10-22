'use client';

import React, { useRef, useState } from 'react';
import { MessageSquareText, Send } from 'lucide-react';
import { ThinkingOrb } from '@/components/ui/ThinkingOrb';

type Turn = { role: 'user' | 'assistant'; content: string };

/** "Ask about Amma": questions answered only from the parent's call records. */
export function AskPanel({ parentId, parentName }: { parentId: string; parentName: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const first = parentName.split(' ')[0];
  const suggestions = [`How has ${first} been this week?`, `Did ${first} take the medicines yesterday?`, 'Anything I should look into?'];

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    setQuestion('');
    const history = turns.slice(-6);
    setTurns(t => [...t, { role: 'user', content: text }]);
    try {
      const res = await fetch(`/api/parents/${parentId}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, history })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not get an answer right now.');
        setTurns(t => t.slice(0, -1));
        setQuestion(text);
      } else {
        setTurns(t => [...t, { role: 'assistant', content: data.answer }]);
      }
    } catch {
      setError('Could not reach the server.');
      setTurns(t => t.slice(0, -1));
      setQuestion(text);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight }));
    }
  };

  return (
    <section className="panel" aria-labelledby="ask-title">
      <div className="panel-head">
        <div>
          <h3 id="ask-title"><MessageSquareText size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />Ask about {first}</h3>
          <p>Answers come only from Saathi&apos;s calls and what your family entered. It is not medical advice.</p>
        </div>
      </div>

      {turns.length > 0 && (
        <div className="ask-log" ref={logRef} aria-live="polite">
          {turns.map((t, i) => (
            <div key={i} className={`ask-bubble ${t.role === 'user' ? 'me' : 'ai'}`}>{t.content}</div>
          ))}
          {busy && <div className="ask-bubble ai ask-thinking"><ThinkingOrb state="composing" size={32} label="Writing an answer" style={{ color: 'var(--teal)' }} /><span>Going through {first}&apos;s calls…</span></div>}
        </div>
      )}

      {turns.length === 0 && (
        <div className="chip-row" style={{ marginBottom: '12px' }}>
          {suggestions.map(s => (
            <button key={s} type="button" className="chip" onClick={() => ask(s)} disabled={busy}>{s}</button>
          ))}
        </div>
      )}

      {error && <div className="alert-box error" role="alert" style={{ marginBottom: '10px' }}><span>{error}</span></div>}

      <form className="ask-form" onSubmit={e => { e.preventDefault(); ask(question); }}>
        <label htmlFor="ask-input" className="sr-only">Your question</label>
        <input
          id="ask-input"
          className="form-input"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder={`e.g. When did ${first} last mention pain?`}
          maxLength={500}
          disabled={busy}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !question.trim()} aria-label="Ask">
          {busy ? <span className="spinner" /> : <Send size={16} />}
        </button>
      </form>
    </section>
  );
}
