'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, PlanId } from '@/lib/types';

export interface AuthResult {
  success: boolean;
  error?: string;
  code?: string;
  notFound?: boolean;
  enteredIdentifier?: string;
  user?: User;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (emailOrPhone: string, password?: string, rememberMe?: boolean) => Promise<AuthResult>;
  loginWithOtp: (phone: string, code: string, rememberMe?: boolean) => Promise<AuthResult>;
  loginWithGoogle: (credential: string, rememberMe?: boolean) => Promise<AuthResult>;
  signupWithGoogle: (credential: string, rememberMe?: boolean) => Promise<AuthResult>;
  signup: (userData: { name: string; email: string; phone: string; password?: string; planId?: PlanId }) => Promise<AuthResult>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setUserDirectly: (user: User | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data.user || null);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the signed-in user on mount
    refreshUser();
    // Back button can restore a page from the browser's back/forward cache,
    // including a protected page from before logout. Reload so the server
    // (proxy + API) decides what is shown.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  const login = async (emailOrPhone: string, password?: string, rememberMe: boolean = true): Promise<AuthResult> => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrPhone, password, rememberMe })
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          success: false,
          error: data.error || 'Failed to log in',
          code: data.code,
          notFound: data.notFound || data.code === 'ACCOUNT_NOT_FOUND',
          enteredIdentifier: data.enteredIdentifier || emailOrPhone
        };
      }
      setUser(data.user);
      return { success: true, user: data.user };
    } catch {
      return { success: false, error: 'Network error. Please try again.' };
    }
  };

  const loginWithOtp = async (phone: string, code: string, rememberMe: boolean = true): Promise<AuthResult> => {
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code, purpose: 'login', rememberMe })
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          success: false,
          error: data.error || 'OTP verification failed',
          code: data.code,
          notFound: data.notFound || data.code === 'ACCOUNT_NOT_FOUND'
        };
      }
      setUser(data.user);
      return { success: true, user: data.user };
    } catch {
      return { success: false, error: 'Network connection failed while verifying OTP.' };
    }
  };

  const loginWithGoogle = async (credential: string, rememberMe: boolean = true): Promise<AuthResult> => {
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, mode: 'login', rememberMe })
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          success: false,
          error: data.error || 'Google login failed',
          code: data.code,
          notFound: data.notFound || data.code === 'ACCOUNT_NOT_FOUND',
          enteredIdentifier: data.enteredEmail
        };
      }
      setUser(data.user);
      return { success: true, user: data.user };
    } catch {
      return { success: false, error: 'Network connection failed during Google sign-in.' };
    }
  };

  const signupWithGoogle = async (credential: string, rememberMe: boolean = true): Promise<AuthResult> => {
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, mode: 'signup', rememberMe })
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          success: false,
          error: data.error || 'Google sign-up failed',
          code: data.code
        };
      }
      setUser(data.user);
      return { success: true, user: data.user };
    } catch {
      return { success: false, error: 'Network connection failed during Google sign-up.' };
    }
  };

  const signup = async (userData: { name: string; email: string; phone: string; password?: string; planId?: PlanId }): Promise<AuthResult> => {
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          success: false,
          error: data.error || 'Failed to sign up',
          code: data.code
        };
      }
      setUser(data.user);
      return { success: true, user: data.user };
    } catch {
      return { success: false, error: 'Network error. Please try again.' };
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      // Full navigation (not router.push) drops all in-memory page state, so a
      // protected page like the dashboard can't keep showing the old data.
      if (typeof window !== 'undefined') window.location.replace('/');
    }
  };

  const setUserDirectly = (newUser: User | null) => {
    setUser(newUser);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        loginWithOtp,
        loginWithGoogle,
        signupWithGoogle,
        signup,
        logout,
        refreshUser,
        setUserDirectly
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
