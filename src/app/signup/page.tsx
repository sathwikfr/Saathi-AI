'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AuthShell, PasswordField, PhoneField, StrengthMeter, phoneOtpAvailable } from '@/components/auth/AuthUI';
import { useAuth } from '@/context/AuthContext';
import { GoogleSignInButton, isGoogleSignInEnabled } from '@/components/GoogleSignInButton';
import { getPlan } from '@/lib/plans';
import { normalizePhone } from '@/lib/phone';
import { PlanId } from '@/lib/types';
import { safeRedirectPath } from '@/lib/redirect';
import { AlertCircle, ArrowRight, CheckCircle2, Phone, Mail, UserCheck, MessageSquareCode, Sparkles } from 'lucide-react';

function SignUpContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Only paid plans (each with a 7-day trial) are offered; old ?plan=free links get Family.
  const requestedPlan = searchParams.get('plan');
  const planParam: PlanId = requestedPlan === 'essential' || requestedPlan === 'solo' || requestedPlan === 'extended' ? requestedPlan : 'family';
  const selectedPlan = getPlan(planParam);
  const identifierParam = searchParams.get('identifier') || '';
  // Family members joining through an invite link go back to it (they don't need a plan of their own).
  const inviteReturn = safeRedirectPath(searchParams.get('redirect'), '');
  const afterSignup = inviteReturn.startsWith('/invite/') ? inviteReturn : `/checkout/confirm?plan=${planParam}`;

  const { signup, signupWithGoogle, loginWithOtp } = useAuth();

  const [signupMode, setSignupMode] = useState<'standard' | 'otp'>('standard');

  // Standard signup form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState(identifierParam.includes('@') ? identifierParam : '');
  const [phone, setPhone] = useState(!identifierParam.includes('@') ? identifierParam : '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // OTP signup form state
  const [otpName, setOtpName] = useState('');
  const [otpPhone, setOtpPhone] = useState(!identifierParam.includes('@') ? identifierParam : '');
  const [otpSent, setOtpSent] = useState(false);
  const otpPhoneResultShown = normalizePhone(otpPhone);
  const otpPhoneShown = otpPhoneResultShown.ok ? otpPhoneResultShown.e164 : otpPhone;
  const [otpCode, setOtpCode] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [devOtpNotice, setDevOtpNotice] = useState<string | null>(null);

  // Google signup state
  const [googleLoading, setGoogleLoading] = useState(false);

  // Error handling
  const [errorMessage, setErrorMessage] = useState('');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [accountExists, setAccountExists] = useState(false);

  // 1. Standard Signup
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setErrorCode(null);
    setAccountExists(false);

    if (!name.trim()) {
      setErrorMessage('Please enter your full name');
      return;
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErrorMessage('Please enter a valid email address');
      return;
    }

    const phoneResult = normalizePhone(phone);
    if (!phoneResult.ok) {
      setErrorMessage(phoneResult.reason);
      return;
    }

    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    const result = await signup({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phoneResult.e164,
      password,
      planId: planParam
    });
    setLoading(false);

    if (result.success) {
      router.push(afterSignup);
    } else {
      setErrorMessage(result.error || 'Failed to create account. Please try again.');
      setErrorCode(result.code || null);
      if (result.code === 'ACCOUNT_EXISTS') {
        setAccountExists(true);
      }
    }
  };

  // 2. Send OTP for signup
  const handleSendOtpSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setErrorCode(null);
    setAccountExists(false);
    setDevOtpNotice(null);

    if (!otpName.trim()) {
      setErrorMessage('Please enter your name.');
      return;
    }

    const otpPhoneResult = normalizePhone(otpPhone);
    if (!otpPhoneResult.ok) {
      setErrorMessage(otpPhoneResult.reason);
      return;
    }

    setOtpLoading(true);
    try {
      const res = await fetch('/api/auth/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: otpPhoneResult.e164, purpose: 'signup' })
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to send OTP.');
        setErrorCode(data.code || null);
        if (data.code === 'ACCOUNT_EXISTS') {
          setAccountExists(true);
        }
        return;
      }

      setOtpSent(true);
      if (data.devOtp) {
        setDevOtpNotice(`[Dev SMS Simulation] Your verification code is: ${data.devOtp}`);
      }
    } catch {
      setErrorMessage('Network error while requesting verification code.');
    } finally {
      setOtpLoading(false);
    }
  };

  // 3. Verify OTP for signup
  const handleVerifyOtpSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setErrorCode(null);

    if (!otpCode.trim() || otpCode.trim().length !== 6) {
      setErrorMessage('Please enter the 6-digit code sent to your phone.');
      return;
    }

    const verifyPhone = normalizePhone(otpPhone);
    if (!verifyPhone.ok) {
      setErrorMessage(verifyPhone.reason);
      return;
    }

    setOtpLoading(true);
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: verifyPhone.e164,
          code: otpCode.trim(),
          purpose: 'signup',
          name: otpName.trim()
        })
      });
      const data = await res.json();
      setOtpLoading(false);

      if (!res.ok) {
        setErrorMessage(data.error || 'Verification failed.');
        setErrorCode(data.code || null);
        return;
      }

      router.push(afterSignup);
    } catch {
      setOtpLoading(false);
      setErrorMessage('Network connection error while verifying code.');
    }
  };

  // 4. Google Signup (verified Google ID token)
  const handleGoogleCredential = async (credential: string) => {
    setGoogleLoading(true);
    setErrorMessage('');
    setErrorCode(null);
    setAccountExists(false);

    const result = await signupWithGoogle(credential);
    setGoogleLoading(false);

    if (result.success) {
      router.push(afterSignup);
    } else {
      setErrorMessage(result.error || 'Google sign-up failed.');
      setErrorCode(result.code || null);
      if (result.code === 'ACCOUNT_EXISTS') {
        setAccountExists(true);
      }
    }
  };

  const switchMode = (mode: 'standard' | 'otp') => {
    setSignupMode(mode);
    setErrorMessage('');
    setAccountExists(false);
  };

  return (
    <>
      <div className="auth-steps">
        <div className="auth-steps-bar" aria-hidden="true">
          <i className="on" /><i /><i /><i />
        </div>
        <p className="auth-steps-label">Step 1 of 4 · Your account</p>
      </div>
      <h1 className="auth-title">Create your account</h1>
      <p className="auth-sub">It takes a couple of minutes. Next, you&apos;ll add your parent.</p>

      <div className="auth-plan">
        <span className="auth-plan-icon" aria-hidden="true"><Sparkles size={18} /></span>
        <div className="auth-plan-text">
          <div className="auth-plan-name">{selectedPlan.name}</div>
          <div className="auth-plan-price">
            {selectedPlan.trialDays}-day free trial, then ₹{selectedPlan.priceMonthly.toLocaleString('en-IN')}/month
          </div>
        </div>
        <Link href="/#plans" className="btn btn-ghost btn-sm">Change</Link>
      </div>

      {isGoogleSignInEnabled && (
        <>
          <GoogleSignInButton mode="signup" onCredential={handleGoogleCredential} disabled={googleLoading || loading} />
          <div className="or-divider">or</div>
        </>
      )}

      {phoneOtpAvailable && (
        <div className="segmented" role="group" aria-label="Sign-up method" style={{ marginBottom: '24px' }}>
          <button type="button" aria-pressed={signupMode === 'standard'} onClick={() => switchMode('standard')}>
            <Mail size={15} /> Email
          </button>
          <button type="button" aria-pressed={signupMode === 'otp'} onClick={() => switchMode('otp')}>
            <Phone size={15} /> Mobile OTP
          </button>
        </div>
      )}

      {accountExists && (
        <div className="notice blue" role="alert">
          <UserCheck size={20} />
          <div>
            <strong>You already have an account</strong>
            <p>{errorMessage || 'An account with this email or phone number already exists.'}</p>
            <Link
              href={`/login?identifier=${encodeURIComponent(email || phone || otpPhone)}&redirect=/checkout/confirm?plan=${planParam}`}
              className="btn btn-primary btn-sm"
            >
              Log in instead <ArrowRight size={14} className="arrow" />
            </Link>
          </div>
        </div>
      )}

      {errorMessage && !accountExists && (
        <div className="alert-box error" role="alert">
          <AlertCircle size={18} />
          <span>{errorMessage}</span>
        </div>
      )}

      {signupMode === 'standard' && (
        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label className="form-label" htmlFor="name">Your name</label>
            <input
              id="name"
              type="text"
              placeholder="e.g. Priya Sharma"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="form-input"
              autoComplete="name"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="form-input"
              autoComplete="email"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="phone">Your mobile number</label>
            <PhoneField id="phone" value={phone} onChange={setPhone} />
            <span className="form-hint">So we can reach you if something needs your attention.</span>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="new-password">Password</label>
            <PasswordField
              id="new-password"
              value={password}
              onChange={setPassword}
              show={showPassword}
              onToggle={() => setShowPassword(!showPassword)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
            <StrengthMeter password={password} />
          </div>

          <button type="submit" disabled={loading} className="btn btn-primary btn-block btn-lg" style={{ marginTop: '8px' }}>
            {loading ? <><span className="spinner" /> Creating your account…</> : <>Continue <ArrowRight size={18} className="arrow" /></>}
          </button>
        </form>
      )}

      {signupMode === 'otp' && (
        <div>
          {!otpSent ? (
            <form onSubmit={handleSendOtpSignup} noValidate>
              <div className="form-group">
                <label className="form-label" htmlFor="otpName">Your name</label>
                <input
                  id="otpName"
                  type="text"
                  placeholder="e.g. Priya Sharma"
                  value={otpName}
                  onChange={(e) => setOtpName(e.target.value)}
                  className="form-input"
                  autoComplete="name"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="otpPhone">Your mobile number</label>
                <PhoneField id="otpPhone" value={otpPhone} onChange={setOtpPhone} />
                <span className="form-hint">We&apos;ll text you a 6-digit code.</span>
              </div>

              <button type="submit" disabled={otpLoading} className="btn btn-primary btn-block btn-lg" style={{ marginTop: '8px' }}>
                {otpLoading ? <><span className="spinner" /> Sending code…</> : <>Send code <ArrowRight size={18} className="arrow" /></>}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtpSignup} noValidate>
              <div className="notice teal">
                <MessageSquareCode size={20} />
                <div>
                  Code sent to <b>{otpPhoneShown}</b>.{' '}
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      setOtpSent(false);
                      setOtpCode('');
                      setDevOtpNotice(null);
                    }}
                  >
                    Change number
                  </button>
                </div>
              </div>

              {devOtpNotice && (
                <div className="alert-box success" style={{ fontWeight: 600 }}>
                  <CheckCircle2 size={18} />
                  <span>{devOtpNotice}</span>
                </div>
              )}

              <div className="form-group">
                <label className="form-label" htmlFor="otpCode">6-digit code</label>
                <input
                  id="otpCode"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="••••••"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  className="form-input otp-input"
                  required
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={otpLoading || otpCode.length !== 6}
                className="btn btn-primary btn-block btn-lg"
                style={{ marginTop: '8px' }}
              >
                {otpLoading ? <><span className="spinner" /> Verifying…</> : <>Verify & continue <ArrowRight size={18} className="arrow" /></>}
              </button>
            </form>
          )}
        </div>
      )}

      <p className="auth-legal">
        By continuing you agree to Aaptha&apos;s <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <p className="auth-foot" style={{ marginTop: '16px' }}>
        Already have an account?{' '}
        <Link href={`/login?redirect=/checkout/confirm?plan=${planParam}`} className="link">
          Log in
        </Link>
      </p>
    </>
  );
}

export default function SignUpPage() {
  return (
    <AuthShell
      asideTitle={<>Tomorrow morning, someone will <em>ask how they&apos;re doing.</em></>}
    >
      <Suspense fallback={<div className="skeleton" style={{ height: '520px' }} />}>
        <SignUpContent />
      </Suspense>
    </AuthShell>
  );
}
