'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { canAddParents, getEffectivePlan } from '@/lib/plans';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Heart, User as UserIcon, LogOut, CreditCard, ChevronDown, LayoutDashboard, UserPlus, Menu, X, ShieldCheck } from 'lucide-react';

const MARKETING_LINKS = [
  { href: '/#how', label: 'How it works' },
  { href: '/#why', label: 'Why a phone call' },
  { href: '/#safety', label: 'Safety' },
  { href: '/#plans', label: 'Pricing' },
];

const APP_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/onboarding', label: 'Add a parent' },
  { href: '/account/billing', label: 'Billing' },
];

export function Brand({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="brand-link" aria-label="Aaptha home">
      <span className="brand-heart" aria-hidden="true">
        <Heart size={15} fill="white" strokeWidth={0} />
      </span>
      <span className="brand-word">Aaptha</span>
    </Link>
  );
}

export function Navbar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // "Add a parent" only appears once a plan's AutoPay is set up (payment details come first).
  // Remind (WhatsApp reminders, one person) is set up from the dashboard instead.
  const navPlan = user ? getEffectivePlan(user.subscription, user.createdAt) : null;
  const canAdd = navPlan ? canAddParents(navPlan) && navPlan.channel === 'call' : false;
  const links = user ? APP_LINKS.filter(l => l.href !== '/onboarding' || canAdd) : MARKETING_LINKS;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen && !sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setSheetOpen(false);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [menuOpen, sheetOpen]);

  const closeAll = () => {
    setMenuOpen(false);
    setSheetOpen(false);
  };

  return (
    <header className={`app-header${scrolled || sheetOpen ? ' scrolled' : ''}`}>
      <div className="wrap app-nav">
        <Brand href="/" />

        <nav className="nav-links" aria-label="Main">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`nav-link${pathname === l.href ? ' active' : ''}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="nav-actions">
          <ThemeToggle />
          {user ? (
            <div ref={menuRef} style={{ position: 'relative' }}>
              <button
                className="user-pill"
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <span className="avatar">{user.avatar || 'CC'}</span>
                <span className="hide-mobile" style={{ color: 'var(--ink)' }}>{user.name.split(' ')[0]}</span>
                <ChevronDown size={14} color="var(--ink-subtle)" style={{ transition: 'transform 200ms', transform: menuOpen ? 'rotate(180deg)' : 'none' }} />
              </button>

              {menuOpen && (
                <div className="menu" role="menu" onClick={closeAll}>
                  <div className="menu-header">
                    <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>{user.name}</p>
                    <p style={{ fontSize: '0.78rem', color: 'var(--ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</p>
                  </div>
                  <Link href="/dashboard" className="menu-item" role="menuitem">
                    <LayoutDashboard size={16} /> Dashboard
                  </Link>
                  {canAdd && (
                    <Link href="/onboarding" className="menu-item" role="menuitem">
                      <UserPlus size={16} /> Add a parent
                    </Link>
                  )}
                  <Link href="/account/profile" className="menu-item" role="menuitem">
                    <UserIcon size={16} /> Profile & notifications
                  </Link>
                  <Link href="/account/billing" className="menu-item" role="menuitem">
                    <CreditCard size={16} /> Subscription & billing
                  </Link>
                  {user.isAdmin && (
                    <Link href="/admin" className="menu-item" role="menuitem">
                      <ShieldCheck size={16} /> Admin overview
                    </Link>
                  )}
                  <div className="divider" style={{ margin: '6px 0' }} />
                  <button onClick={() => logout()} className="menu-item danger" role="menuitem">
                    <LogOut size={16} /> Log out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link href="/login" className="btn btn-quiet btn-sm hide-mobile">
                Log in
              </Link>
              <Link href="/signup" className="btn btn-primary btn-sm">
                Get started
              </Link>
            </>
          )}

          <button
            className="btn btn-ghost btn-icon nav-toggle"
            onClick={() => setSheetOpen((o) => !o)}
            aria-label={sheetOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={sheetOpen}
            aria-controls="mobile-sheet"
          >
            {sheetOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      <div id="mobile-sheet" className={`mobile-sheet${sheetOpen ? ' open' : ''}`} aria-hidden={!sheetOpen}>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="sheet-link" onClick={closeAll} tabIndex={sheetOpen ? 0 : -1}>
            {l.label}
          </Link>
        ))}
        {!user && (
          <div className="sheet-actions">
            <Link href="/login" className="btn btn-ghost" onClick={closeAll} tabIndex={sheetOpen ? 0 : -1}>Log in</Link>
            <Link href="/signup" className="btn btn-primary" onClick={closeAll} tabIndex={sheetOpen ? 0 : -1}>Get started</Link>
          </div>
        )}
      </div>
    </header>
  );
}
