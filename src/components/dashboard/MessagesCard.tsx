'use client';

import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send } from 'lucide-react';

type Message = {
  id: string;
  direction: 'to_parent' | 'from_parent';
  authorName: string;
  text: string;
  status: 'pending' | 'delivered' | 'received';
  createdAt: string;
  deliveredAt?: string;
  mine: boolean;
};

const MAX = 200;
const day = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/** Short messages Saathi reads out on the next call, and what the parent asked Saathi to pass on. */
export function MessagesCard({ parentId, parentName, canSend = true, onToast }: {
  parentId: string;
  parentName: string;
  /** false for view-only members: they see the messages but cannot add one */
  canSend?: boolean;
  onToast: (text: string, type?: 'success' | 'info' | 'error') => void;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [version, setVersion] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const first = parentName.split(' ')[0];

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/parents/${parentId}/messages`)
      .then(r => (r.ok ? r.json() : { messages: [] }))
      .then(d => {
        if (cancelled) return;
        setMessages([...(d.messages || [])].reverse());
        requestAnimationFrame(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight }));
      })
      .catch(() => !cancelled && setMessages([]));
    return () => {
      cancelled = true;
    };
  }, [parentId, version]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    const res = await fetch(`/api/parents/${parentId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) return onToast(data.error || 'Could not save the message.', 'error');
    setText('');
    onToast(data.message, 'success');
    setVersion(v => v + 1);
  };

  const takeBack = async (id: string) => {
    const res = await fetch(`/api/parents/${parentId}/messages?messageId=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) setVersion(v => v + 1);
  };

  return (
    <section className="panel" aria-labelledby="msg-title">
      <div className="panel-head">
        <div>
          <h3 id="msg-title"><MessageCircle size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />Message {first}</h3>
          <p>Saathi reads it out on the next call {first} answers. Anything {first} wants to tell you comes back here.</p>
        </div>
      </div>

      {messages === null ? (
        <div className="skeleton" style={{ height: '80px', marginBottom: '12px' }} />
      ) : messages.length > 0 && (
        <div className="thread" ref={logRef} aria-live="polite">
          {messages.map(m => (
            <div key={m.id} className={`thread-msg ${m.direction === 'to_parent' ? 'out' : 'in'}`}>
              <div>{m.text}</div>
              <div className="meta">
                {m.direction === 'to_parent' ? (
                  <>
                    <span>{m.mine ? 'You' : m.authorName}</span>
                    <span>
                      {m.status === 'delivered' && m.deliveredAt ? `Told ${first} ${day(m.deliveredAt)}` : 'Waiting for the next call'}
                    </span>
                    {m.mine && m.status === 'pending' && (
                      <button type="button" className="link-btn" onClick={() => takeBack(m.id)}>Take back</button>
                    )}
                  </>
                ) : (
                  <span>{first} said on the call · {day(m.createdAt)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!canSend && <p className="form-hint">Only the owner and co-managers can send messages for Saathi to read out.</p>}
      {canSend && <form onSubmit={send} className="ask-form">
        <label htmlFor="msg-text" className="sr-only">Message for {first}</label>
        <input
          id="msg-text"
          className="form-input"
          value={text}
          onChange={e => setText(e.target.value.slice(0, MAX))}
          placeholder={`e.g. Will call you on Sunday evening`}
          maxLength={MAX}
        />
        <button type="submit" className="btn btn-primary" disabled={sending || !text.trim()} aria-label="Send">
          {sending ? <span className="spinner" /> : <Send size={16} />}
        </button>
      </form>}
      {canSend && text.length > MAX - 40 && <p className="form-hint" style={{ marginTop: '6px' }}>{MAX - text.length} characters left</p>}
    </section>
  );
}
