'use client';

import React, { useState, useEffect } from 'react';
import { AccountShell } from '@/components/account/AccountUI';
import { PasswordField, StrengthMeter } from '@/components/auth/AuthUI';
import { useAuth } from '@/context/AuthContext';
import { NotificationPreferences } from '@/lib/types';
import { User as UserIcon, Mail, Lock, Bell, CheckCircle2, AlertCircle, ShieldCheck, KeyRound, Save, Smartphone, X } from 'lucide-react';
import { WhatsAppSettings } from '@/components/account/WhatsAppSettings';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`;
const COMMON_ZONES = [
  'Asia/Kolkata', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto',
  'Europe/London', 'Europe/Berlin', 'Europe/Amsterdam', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland'
];

/** Common zones plus the browser's own and the saved one. */
function timeZoneOptions(saved?: string | null): string[] {
  let detected = '';
  try {
    detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    detected = '';
  }
  return [...new Set([...COMMON_ZONES, detected, saved || ''].filter(Boolean))];
}

export default function EditProfilePage() {
  const { user, refreshUser, setUserDirectly } = useAuth();

  // Active sub-tab: 'profile' | 'security' | 'notifications'
  const [activeTab, setActiveTab] = useState<'profile' | 'security' | 'notifications'>('profile');

  // Profile Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [avatar, setAvatar] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  // Password Form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);

  // Notification Preferences state
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>({
    whatsapp: true,
    sms: true,
    email: true,
    push: false,
    minimumAlertLevel: 1
  });
  const [notifSaving, setNotifSaving] = useState(false);

  // Feedback Notifications
  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // /account/profile?tab=notifications (linked from the dashboard's WhatsApp prompt)
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the URL after mount
    if (tab === 'notifications' || tab === 'security') setActiveTab(tab);
  }, []);

  // Load initial data from user object
  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setEmail(user.email || '');
      setPhone(user.phone || '');
      setAvatar(user.avatar || '');
      if (user.notificationPreferences) {
        setNotifPrefs({
          ...user.notificationPreferences,
          whatsapp: user.notificationPreferences.whatsapp ?? true,
          sms: user.notificationPreferences.sms ?? true,
          email: user.notificationPreferences.email ?? true,
          push: user.notificationPreferences.push ?? false,
          minimumAlertLevel: user.notificationPreferences.minimumAlertLevel ?? 1
        });
      }
    }
  }, [user]);

  // Handle Save Profile
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotification(null);

    if (!name.trim()) {
      setNotification({ type: 'error', message: 'Full name cannot be empty.' });
      return;
    }

    if (!email.trim() || !email.includes('@')) {
      setNotification({ type: 'error', message: 'Please provide a valid email address.' });
      return;
    }

    setProfileSaving(true);
    try {
      const res = await fetch('/api/account/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          avatar: avatar.trim() || undefined
        })
      });

      const data = await res.json();
      if (res.ok) {
        if (data.user) {
          setUserDirectly(data.user);
        }
        await refreshUser();
        setNotification({
          type: 'success',
          message: data.message || 'Profile changes saved successfully!'
        });
      } else {
        setNotification({
          type: 'error',
          message: data.error || 'Failed to update profile.'
        });
      }
    } catch {
      setNotification({
        type: 'error',
        message: 'Network error occurred while saving profile.'
      });
    } finally {
      setProfileSaving(false);
    }
  };

  // Handle Update Password
  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotification(null);

    if (!currentPassword) {
      setNotification({ type: 'error', message: 'Please enter your current password.' });
      return;
    }

    if (newPassword.length < 8) {
      setNotification({ type: 'error', message: 'New password must be at least 8 characters long.' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setNotification({ type: 'error', message: 'New passwords do not match.' });
      return;
    }

    setPasswordSaving(true);
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword
        })
      });

      const data = await res.json();
      if (res.ok) {
        setNotification({
          type: 'success',
          message: data.message || 'Password updated successfully!'
        });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setNotification({
          type: 'error',
          message: data.error || 'Failed to change password.'
        });
      }
    } catch {
      setNotification({
        type: 'error',
        message: 'Network error occurred while updating password.'
      });
    } finally {
      setPasswordSaving(false);
    }
  };

  // Handle Save Notifications
  const handleSaveNotifications = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotification(null);
    setNotifSaving(true);

    try {
      const res = await fetch('/api/account/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notificationPreferences: notifPrefs
        })
      });

      const data = await res.json();
      if (res.ok) {
        if (data.user) {
          setUserDirectly(data.user);
        }
        await refreshUser();
        setNotification({
          type: 'success',
          message: 'Notification channels and delivery preferences saved!'
        });
      } else {
        setNotification({
          type: 'error',
          message: data.error || 'Failed to update notification preferences.'
        });
      }
    } catch {
      setNotification({
        type: 'error',
        message: 'Network error occurred while saving preferences.'
      });
    } finally {
      setNotifSaving(false);
    }
  };

  // Compute initials preview
  const displayInitials = avatar.trim().toUpperCase().substring(0, 3) || (name || 'Caregiver')
    .split(' ')
    .filter(Boolean)
    .map(p => p[0])
    .join('')
    .toUpperCase()
    .substring(0, 2) || 'CC';

  const SECTIONS = [
    { id: 'profile' as const, label: 'Personal details', icon: UserIcon },
    { id: 'security' as const, label: 'Password', icon: KeyRound },
    { id: 'notifications' as const, label: 'Alerts', icon: Bell }
  ];

  return (
    <AccountShell active="profile" title="Profile & notifications" sub="Your details, your password and how we reach you.">
      {notification && (
        <div className={`alert-box ${notification.type === 'error' ? 'error' : notification.type === 'info' ? 'info' : 'success'}`} role={notification.type === 'error' ? 'alert' : 'status'}>
          {notification.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          <span style={{ flex: 1 }}>{notification.message}</span>
          <button className="icon-btn" onClick={() => setNotification(null)} aria-label="Dismiss" style={{ width: '24px', height: '24px' }}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="account-layout">
        <aside>
          <div className="panel" style={{ padding: '20px', marginBottom: '14px', textAlign: 'center' }}>
            <span className="avatar" style={{ width: '64px', height: '64px', fontSize: '1.3rem', margin: '0 auto 12px' }}>{displayInitials}</span>
            <div style={{ fontWeight: 600 }}>{user?.name || 'Your name'}</div>
            <div style={{ fontSize: '0.84rem', color: 'var(--ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</div>
          </div>
          <nav className="side-nav" role="tablist" aria-label="Profile sections">
            {SECTIONS.map((s) => (
              <button key={s.id} role="tab" aria-selected={activeTab === s.id} onClick={() => setActiveTab(s.id)}>
                <s.icon size={16} /> {s.label}
              </button>
            ))}
          </nav>
        </aside>

        <div role="tabpanel">
          {/* PERSONAL DETAILS */}
          {activeTab === 'profile' && (
            <form onSubmit={handleSaveProfile} className="panel animate-fade-in" noValidate>
              <div className="panel-head">
                <div>
                  <h2 style={{ fontSize: '1.3rem' }}>Personal details</h2>
                  <p>How we address you and where we send alerts about your parents.</p>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="pf-name">Full name</label>
                <input id="pf-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className="form-input" autoComplete="name" required />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="pf-email">Email</label>
                  <input id="pf-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="form-input" autoComplete="email" required />
                  <span className="form-hint">Alerts and receipts go here.</span>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="pf-phone">Mobile number</label>
                  <input id="pf-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" className="form-input" autoComplete="tel" />
                  <span className="form-hint">Used for phone OTP login. Include your country code, e.g. +1 415 555 0100.</span>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="pf-avatar">Initials <span className="form-hint">Optional</span></label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <input
                    id="pf-avatar"
                    type="text"
                    maxLength={3}
                    value={avatar}
                    onChange={(e) => setAvatar(e.target.value.toUpperCase())}
                    placeholder={displayInitials}
                    className="form-input"
                    style={{ width: '96px', textAlign: 'center', fontWeight: 600, letterSpacing: '0.12em' }}
                  />
                  <span className="form-hint">Shown on your avatar. Leave blank to use your name.</span>
                </div>
              </div>

              <div className="wizard-nav" style={{ justifyContent: 'flex-end' }}>
                <button type="submit" disabled={profileSaving} className="btn btn-primary" style={{ flex: 'none' }}>
                  {profileSaving ? <><span className="spinner" /> Saving…</> : <><Save size={16} /> Save changes</>}
                </button>
              </div>
            </form>
          )}

          {/* PASSWORD */}
          {activeTab === 'security' && (
            <form onSubmit={handleUpdatePassword} className="panel animate-fade-in" noValidate>
              <div className="panel-head">
                <div>
                  <h2 style={{ fontSize: '1.3rem' }}>Change password</h2>
                  <p>Use at least 8 characters. You&apos;ll stay logged in on this device.</p>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="pw-current">Current password</label>
                <PasswordField
                  id="pw-current"
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  show={showCurrentPassword}
                  onToggle={() => setShowCurrentPassword(!showCurrentPassword)}
                  autoComplete="current-password"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="pw-new">New password</label>
                  <PasswordField
                    id="pw-new"
                    value={newPassword}
                    onChange={setNewPassword}
                    show={showNewPassword}
                    onToggle={() => setShowNewPassword(!showNewPassword)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                  />
                  <StrengthMeter password={newPassword} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="pw-confirm">Confirm new password</label>
                  <input
                    id="pw-confirm"
                    type={showNewPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={`form-input${confirmPassword && confirmPassword !== newPassword ? ' error' : ''}`}
                    autoComplete="new-password"
                    required
                  />
                  {confirmPassword && confirmPassword !== newPassword && <span className="form-error">Passwords don&apos;t match yet</span>}
                </div>
              </div>

              <div className="wizard-nav" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="fine-print" style={{ flex: 1 }}>
                  <ShieldCheck size={16} /> <span>Forgot it? Log out and use &ldquo;Forgot password&rdquo; on the login page.</span>
                </span>
                <button type="submit" disabled={passwordSaving} className="btn btn-primary" style={{ flex: 'none' }}>
                  {passwordSaving ? <><span className="spinner" /> Updating…</> : <><Lock size={16} /> Update password</>}
                </button>
              </div>
            </form>
          )}

          {/* ALERTS */}
          {activeTab === 'notifications' && (
            <form onSubmit={handleSaveNotifications} className="panel animate-fade-in">
              <div className="panel-head">
                <div>
                  <h2 style={{ fontSize: '1.3rem' }}>Call updates</h2>
                  <p>How we tell you what happened on calls with your parents. Receipts and account emails always come by email.</p>
                </div>
              </div>

              <div>
                <WhatsAppSettings />
              </div>

              <div className="form-group" style={{ marginTop: '12px' }}>
                <label className="form-label" htmlFor="min-level">Send me</label>
                <select
                  id="min-level"
                  value={notifPrefs.minimumAlertLevel}
                  onChange={(e) => setNotifPrefs({ ...notifPrefs, minimumAlertLevel: Number(e.target.value) })}
                  className="form-input"
                >
                  <option value={1}>Every call result (recommended)</option>
                  <option value={2}>Only when something needs attention: missed medicines, unanswered calls and more</option>
                  <option value={3}>Only health concerns: feeling unwell, pain, dizziness</option>
                  <option value={4}>Only emergencies</option>
                </select>
                <span className="form-hint">Emergencies are always sent. Every call and alert also appears on your dashboard.</span>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="tz">Your time zone</label>
                <select
                  id="tz"
                  className="form-input"
                  value={notifPrefs.timezone || 'Asia/Kolkata'}
                  onChange={(e) => setNotifPrefs({ ...notifPrefs, timezone: e.target.value === 'Asia/Kolkata' ? null : e.target.value })}
                >
                  {timeZoneOptions(notifPrefs.timezone).map(tz => <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>)}
                </select>
                <span className="form-hint">Summaries arrive at the hour you pick in this time zone. Call times stay in India time.</span>
              </div>

              <div>
                <div className="toggle-row">
                  <div>
                    <strong>One summary a day instead of every call</strong>
                    <p>Routine results wait for one evening message. Anything that needs attention still comes at once.</p>
                    {notifPrefs.dailySummary && (
                      <select aria-label="Daily summary time" className="form-input" style={{ marginTop: '8px', maxWidth: '200px' }} value={notifPrefs.dailySummaryHour ?? 20} onChange={(e) => setNotifPrefs({ ...notifPrefs, dailySummaryHour: Number(e.target.value) })}>
                        {HOURS.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}
                      </select>
                    )}
                  </div>
                  <button type="button" role="switch" aria-checked={!!notifPrefs.dailySummary} aria-label="Daily summary" className="switch" onClick={() => setNotifPrefs({ ...notifPrefs, dailySummary: !notifPrefs.dailySummary })} />
                </div>
                <div className="toggle-row">
                  <div>
                    <strong>Weekly summary</strong>
                    <p>Medicines taken, mood through the week and anything they mentioned, with a nudge if it is a good week to call.</p>
                    {(notifPrefs.weeklyDigest ?? true) && (
                      <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                        <select aria-label="Weekly summary day" className="form-input" style={{ maxWidth: '170px' }} value={notifPrefs.digestDay ?? 0} onChange={(e) => setNotifPrefs({ ...notifPrefs, digestDay: Number(e.target.value) })}>
                          {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                        </select>
                        <select aria-label="Weekly summary time" className="form-input" style={{ maxWidth: '170px' }} value={notifPrefs.digestHour ?? 9} onChange={(e) => setNotifPrefs({ ...notifPrefs, digestHour: Number(e.target.value) })}>
                          {HOURS.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                  <button type="button" role="switch" aria-checked={notifPrefs.weeklyDigest ?? true} aria-label="Weekly summary" className="switch" onClick={() => setNotifPrefs({ ...notifPrefs, weeklyDigest: !(notifPrefs.weeklyDigest ?? true) })} />
                </div>
                <div className="toggle-row">
                  <div>
                    <strong>Monthly summary</strong>
                    <p>On the 1st, with a one-page summary you can show their doctor.</p>
                  </div>
                  <button type="button" role="switch" aria-checked={notifPrefs.monthlySummary ?? true} aria-label="Monthly summary" className="switch" onClick={() => setNotifPrefs({ ...notifPrefs, monthlySummary: !(notifPrefs.monthlySummary ?? true) })} />
                </div>
                <div className="toggle-row">
                  <div>
                    <strong>Phone me in an emergency</strong>
                    <p>Besides WhatsApp, an automated call wakes you if Saathi hears an emergency, even at night where you are. Say &ldquo;yes&rdquo; to tell us you are on it.</p>
                    {(notifPrefs.wakeForEmergency ?? true) && (
                      <input
                        aria-label="Number to call in an emergency"
                        className="form-input"
                        style={{ marginTop: '8px', maxWidth: '260px' }}
                        type="tel"
                        placeholder={phone || '+1 555 123 4567'}
                        value={notifPrefs.emergencyPhone || ''}
                        onChange={(e) => setNotifPrefs({ ...notifPrefs, emergencyPhone: e.target.value })}
                      />
                    )}
                  </div>
                  <button type="button" role="switch" aria-checked={notifPrefs.wakeForEmergency ?? true} aria-label="Emergency phone call" className="switch" onClick={() => setNotifPrefs({ ...notifPrefs, wakeForEmergency: !(notifPrefs.wakeForEmergency ?? true) })} />
                </div>
              </div>

              <div>
                <div className="toggle-row">
                  <div>
                    <strong><Mail size={16} color="var(--teal)" /> Email backup</strong>
                    <p>
                      Until WhatsApp updates are live, alerts that need attention are emailed to {email || 'your email'}.
                      After that, we email only if a health concern or emergency can&apos;t reach you on WhatsApp.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={notifPrefs.email}
                    aria-label="Email backup"
                    className="switch"
                    onClick={() => setNotifPrefs({ ...notifPrefs, email: !notifPrefs.email })}
                  />
                </div>
                <div className="toggle-row">
                  <div>
                    <strong><Smartphone size={16} color="var(--ink-subtle)" /> SMS <span className="badge badge-neutral">Coming soon</span></strong>
                    <p>A text message for urgent alerts.</p>
                  </div>
                  <button type="button" role="switch" aria-checked={false} aria-label="SMS alerts (coming soon)" className="switch" disabled />
                </div>
              </div>

              <div className="wizard-nav" style={{ justifyContent: 'flex-end' }}>
                <button type="submit" disabled={notifSaving} className="btn btn-primary" style={{ flex: 'none' }}>
                  {notifSaving ? <><span className="spinner" /> Saving…</> : <><Save size={16} /> Save preferences</>}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </AccountShell>
  );
}
