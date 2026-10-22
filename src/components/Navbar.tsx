'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { canAddParents, getEffectivePlan } from '@/lib/plans';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Heart, User as UserIcon, LogOut, CreditCard, ChevronDown, LayoutDashboard, UserPlus, Menu, X, ShieldCheck, ArrowRight } from 'lucide-react';

const MARKETING_LINKS = [
  { href: '/#how', label: 'How it works' },   // calls and WhatsApp reminders, behind one toggle
  { href: '/#safety', label: 'Safety' },
  { href: '/#why', label: 'Why Aaptha' },
  { href: '/#plans', label: 'Pricing' },
  { href: '/#faq', label: 'FAQ' },
];

const APP_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/onboarding', label: 'Add a parent' },
  { href: '/account/billing', label: 'Billing' },
];

export function Brand({ href = '/' }: { href?: string }) {
  const pathname = usePathname();
  return (
    <Link
      href={href}
      className="brand-link"
      aria-label="Aaptha home"
      // Already on that page: a link to it does nothing, so take the visitor back to the top instead.
      onClick={() => { if (pathname === href) window.scrollTo({ top: 0, behavior: 'smooth' }); }}
    >
      <span className="brand-heart" aria-hidden="true">
        <Heart size={15} fill="white" strokeWidth={0} />
      </span>
      <span className="brand-word">Aaptha</span>
    </Link>
  );
}

// The sliding highlight sits behind `el` (the hovered link), else the active link, else hides.
function placeIndicator(nav: HTMLElement | null, el?: HTMLElement) {
  if (!nav) return;
  const target = el ?? nav.querySelector<HTMLElement>('.nav-link[aria-current]');
  if (!target) {
    nav.dataset.indicator = 'off';
    return;
  }
  nav.style.setProperty('--ix', `${target.offsetLeft}px`);
  nav.style.setProperty('--iw', `${target.offsetWidth}px`);
  nav.dataset.indicator = 'on';
}

export function Navbar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeHash, setActiveHash] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  // On the landing the bar folds into the call island once scrolled and follows the section being read.
  const float = pathname === '/';
  const isActive = (href: string) => pathname === href || (float && activeHash !== '' && href === `/#${activeHash}`);

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

  // Scroll-spy: the section crossing the middle of the screen is the active link.
  useEffect(() => {
    if (!float) return;
    const sections = ['how', 'remind', 'why', 'safety', 'plans', 'faq', 'start']
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActiveHash(e.target.id === 'start' ? '' : e.target.id === 'remind' ? 'how' : e.target.id);
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    sections.forEach((s) => io.observe(s));
    const onScroll = () => {
      if (window.scrollY < 200) setActiveHash('');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, [float]);

  const indicatorToActive = () => placeIndicator(navRef.current);
  useEffect(() => placeIndicator(navRef.current), [activeHash, pathname]);

  // Close the sheet when the window grows past the phone layout.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 901px)');
    const onChange = () => mq.matches && setSheetOpen(false);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // The full-screen sheet holds the page still behind it. On <body>, not <html>: body has overflow-x hidden,
  // so hiding <html> would make body the scroller and the sticky header would scroll away.
  useEffect(() => {
    if (!sheetOpen) return;
    const body = document.body;
    const prev = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = prev;
    };
  }, [sheetOpen]);

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

  // The scrolled "island" capsule (links folded into a dark pill naming the section) is switched off (user, 2026-10-18).
  const compact = false;
  const islandLabel = links.find((l) => isActive(l.href))?.label ?? 'Aaptha';

  const navEl = (
    <nav ref={navRef} className="nav-links" aria-label="Main" onMouseLeave={indicatorToActive}>
      {float && <span className="nav-indicator" aria-hidden="true" />}
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`nav-link${isActive(l.href) ? ' active' : ''}`}
          aria-current={isActive(l.href) ? 'true' : undefined}
          onMouseEnter={(e) => placeIndicator(navRef.current, e.currentTarget)}
          onFocus={(e) => placeIndicator(navRef.current, e.currentTarget)}
          onBlur={indicatorToActive}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );

  return (
    <header className={`app-header${float ? ' float' : ''}${scrolled || sheetOpen ? ' scrolled' : ''}${compact ? ' compact' : ''}${sheetOpen ? ' sheet-open' : ''}`}>
      <div className={`wrap app-nav${float ? ' app-nav-wide' : ''}`}>
        <Brand href="/" />

        {float ? (
          // The call island: links at the top; once scrolled it folds into a dark capsule that names the section
          // being read, and opens back into the links on hover / focus (on phones a tap opens the menu sheet).
          <div className="island">
            <div className="island-fold island-peek-fold">
              <div>
                <button
                  type="button"
                  className="island-peek"
                  tabIndex={compact ? 0 : -1}
                  aria-label={`Menu. Now reading: ${islandLabel}`}
                  onClick={() => {
                    if (window.matchMedia('(max-width: 900px)').matches) setSheetOpen(true);
                    else navRef.current?.querySelector<HTMLElement>('.nav-link')?.focus();
                  }}
                >
                  <span className="brand-heart island-heart" aria-hidden="true"><Heart size={11} fill="currentColor" strokeWidth={0} /></span>
                  <span className="island-dot" aria-hidden="true" />
                  <span key={islandLabel} className="island-label">{islandLabel}</span>
                </button>
              </div>
            </div>
            <div className="island-fold island-body-fold">
              <div>
                {navEl}
                {!user && (
                  <Link href="/signup" className="btn btn-primary btn-sm island-cta" tabIndex={compact ? 0 : -1}>
                    Try free
                  </Link>
                )}
              </div>
            </div>
          </div>
        ) : navEl}

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
                <span>Start<span className="hide-mobile"> free trial</span></span> <ArrowRight size={15} className="hide-mobile" />
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
        {links.map((l, i) => (
          <Link
            key={l.href}
            href={l.href}
            className="sheet-link"
            onClick={closeAll}
            tabIndex={sheetOpen ? 0 : -1}
            style={{ '--i': i } as React.CSSProperties}
          >
            {l.label}
          </Link>
        ))}
        {!user && (
          <div className="sheet-actions" style={{ '--i': links.length } as React.CSSProperties}>
            <Link href="/login" className="btn btn-ghost" onClick={closeAll} tabIndex={sheetOpen ? 0 : -1}>Log in</Link>
            <Link href="/signup" className="btn btn-primary" onClick={closeAll} tabIndex={sheetOpen ? 0 : -1}>Start free trial</Link>
          </div>
        )}
      </div>
    </header>
  );
}
