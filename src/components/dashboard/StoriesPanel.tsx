'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Eye, EyeOff } from 'lucide-react';

type Story = { id: string; title: string; text: string; createdAt: string; hidden: boolean };

const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

/** Memories the parent shared on calls and agreed the family may keep: the life-stories book. */
export function StoriesPanel({ parentId, parentName, manage }: { parentId: string; parentName: string; manage: boolean }) {
  const [stories, setStories] = useState<Story[] | null>(null);
  const [version, setVersion] = useState(0);
  const first = parentName.split(' ')[0];

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/parents/${parentId}/stories${manage ? '?all=1' : ''}`)
      .then(r => (r.ok ? r.json() : { stories: [] }))
      .then(d => !cancelled && setStories(d.stories || []))
      .catch(() => !cancelled && setStories([]));
    return () => {
      cancelled = true;
    };
  }, [parentId, manage, version]);

  const setHidden = async (id: string, hidden: boolean) => {
    const res = await fetch(`/api/parents/${parentId}/stories`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, hidden })
    });
    if (res.ok) setVersion(v => v + 1);
  };

  const shown = (stories || []).filter(s => !s.hidden).length;

  return (
    <section className="panel" aria-labelledby="stories-title">
      <div className="panel-head">
        <div>
          <h3 id="stories-title"><BookOpen size={18} style={{ verticalAlign: '-3px', marginRight: '6px' }} />{first}&apos;s stories</h3>
          <p>Memories {first} told Saathi, mostly on the weekly chat, and agreed the family could keep. Written down in Saathi&apos;s words.</p>
        </div>
        {shown > 0 && (
          <Link href={`/dashboard/stories/${parentId}`} className="btn btn-ghost btn-sm"><BookOpen size={14} /> Open as a book</Link>
        )}
      </div>

      {stories === null ? (
        <div className="skeleton" style={{ height: '120px' }} />
      ) : stories.length === 0 ? (
        <div className="empty" style={{ padding: '28px 16px' }}>
          <span className="icon-tile gold"><BookOpen size={24} /></span>
          <h3>No stories yet</h3>
          <p>When {first} shares a memory, like their wedding, their first job or the village they grew up in, Saathi asks if the family may keep it, and it appears here.</p>
        </div>
      ) : (
        <div className="list">
          {stories.map(s => (
            <article key={s.id} className={`story-card${s.hidden ? ' hidden-story' : ''}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' }}>
                <div>
                  <h4>{s.title}</h4>
                  <div style={{ fontSize: '0.78rem', color: 'var(--ink-subtle)', marginBottom: '8px' }}>
                    Told {day(s.createdAt)}{s.hidden ? ' · left out of the book' : ''}
                  </div>
                </div>
                {manage && (
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => setHidden(s.id, !s.hidden)}>
                    {s.hidden ? <><Eye size={14} /> Put back</> : <><EyeOff size={14} /> Leave out</>}
                  </button>
                )}
              </div>
              <p>{s.text}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
