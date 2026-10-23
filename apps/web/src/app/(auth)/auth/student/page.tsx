'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SproutIcon, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type Tab = 'signup' | 'login';
type SignupStep = 'form' | 'verify';

export default function StudentAuthPage() {
  const [tab, setTab] = useState<Tab>('login');

  return (
    <div className="min-h-dvh w-full bg-background flex flex-col items-center justify-center px-margin py-space-xl pt-safe pb-safe">
      {/* Brand header */}
      <header className="flex flex-col items-center text-center mb-space-xl">
        <div className="relative flex items-center justify-center w-16 h-16 rounded-full bg-tertiary-fixed/30 mb-space-md shadow-sm">
          <SproutIcon size="lg" className="text-primary" />
          <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-primary-fixed flex items-center justify-center">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          </div>
        </div>
        <div className="flex items-center gap-1.5 mb-space-xs">
          <h1 className="font-headline-xl-mobile text-on-surface tracking-tight">Tangkay Scan</h1>
          <span className="bg-primary-fixed/50 text-on-primary-fixed text-[11px] font-label-sm px-2 py-0.5 rounded-full">
            v1.2
          </span>
        </div>
        <p className="font-body-md text-on-surface-variant max-w-xs">
          Student portal
        </p>
      </header>

      {/* Auth card */}
      <section className="w-full max-w-[360px] bg-surface-container-lowest rounded-xl shadow-card p-space-lg flex flex-col">
        {/* Segmented tab switcher */}
        <div className="flex p-1 bg-surface-container rounded-xl mb-space-lg" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'login'}
            onClick={() => setTab('login')}
            className={[
              'flex-1 py-2 text-center rounded-lg font-label-md text-[12px] transition-all duration-200 flex items-center justify-center gap-1.5',
              tab === 'login'
                ? 'bg-surface-container-lowest text-primary shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface',
            ].join(' ')}
            type="button"
          >
            {tab === 'login' && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
            Log in
          </button>
          <button
            role="tab"
            aria-selected={tab === 'signup'}
            onClick={() => setTab('signup')}
            className={[
              'flex-1 py-2 text-center rounded-lg font-label-md text-[12px] transition-all duration-200 flex items-center justify-center gap-1.5',
              tab === 'signup'
                ? 'bg-surface-container-lowest text-primary shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface',
            ].join(' ')}
            type="button"
          >
            {tab === 'signup' && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
            Create account
          </button>
        </div>

        {/* Forms */}
        {tab === 'login' ? (
          <LoginForm onSwitchToSignup={() => setTab('signup')} />
        ) : (
          <SignupForm onSwitchToLogin={() => setTab('login')} />
        )}
      </section>

      {/* Back link */}
      <Link
        href="/welcome"
        className="mt-space-lg flex items-center gap-1.5 font-label-md text-[12px] text-on-surface-variant hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-[16px] leading-none">arrow_back</span>
        Back to role selection
      </Link>
    </div>
  );
}

// ── Log in form ───────────────────────────────────────────────────────────────

interface LoginFormProps {
  onSwitchToSignup: () => void;
}

function LoginForm({ onSwitchToSignup }: LoginFormProps) {
  const router = useRouter();
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [unverified, setUnverified] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSent, setResendSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setUnverified(false);
    setLoading(true);
    try {
      await api.post('/api/auth/student/login', { email, password });
      await refresh();
      router.replace('/student/rooms');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      if (msg.toLowerCase().includes('verify your email') || msg.includes('email_not_verified')) {
        setUnverified(true);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResendSent(false);
    setResendLoading(true);
    try {
      await api.post('/api/auth/student/send-verification', { email });
      setResendSent(true);
    } catch {
      // silent — endpoint always returns 200
    } finally {
      setResendLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-space-md">
      <AuthField label="Email Address" htmlFor="login-email">
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="student@school.edu.ph"
          required
          className="auth-input pr-10"
        />
        <MaterialIcon name="mail" />
      </AuthField>

      <AuthField label="Password" htmlFor="login-password">
        <input
          id="login-password"
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••••••"
          required
          className="auth-input pr-10"
        />
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          aria-label="Toggle password visibility"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-outline hover:text-on-surface focus:outline-none"
        >
          <MaterialIcon name={showPassword ? 'visibility_off' : 'visibility'} />
        </button>
      </AuthField>

      {error && <p className="font-body-sm text-error -mt-1">{error}</p>}

      {unverified && (
        <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col gap-2 border border-outline-variant/30">
          <p className="font-body-sm text-on-surface-variant">
            Your email isn&apos;t verified yet. Check your inbox or resend the link.
          </p>
          {resendSent ? (
            <p className="font-body-sm text-primary">✓ Verification email sent.</p>
          ) : (
            <button
              type="button"
              onClick={handleResend}
              disabled={resendLoading}
              className="self-start font-label-md text-primary hover:opacity-80 transition-opacity disabled:opacity-50"
            >
              {resendLoading ? 'Sending…' : 'Resend verification email'}
            </button>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-primary text-on-primary py-3.5 px-6 rounded-full font-label-lg text-[14px] shadow-sm hover:opacity-95 active:scale-[0.99] transition-all flex items-center justify-center gap-2 mt-space-xs disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? (
          <Spinner className="text-on-primary" />
        ) : (
          <>
            <span>Log in</span>
            <span className="material-symbols-outlined text-[16px] leading-none">arrow_forward</span>
          </>
        )}
      </button>

      <div className="flex items-center justify-center mt-space-xs">
        <button
          type="button"
          onClick={onSwitchToSignup}
          className="font-body-md text-on-surface-variant hover:text-primary transition-colors focus:outline-none py-1"
        >
          New student?{' '}
          <span className="font-label-md text-primary underline underline-offset-4 ml-1">
            Create account
          </span>
        </button>
      </div>
    </form>
  );
}

// ── Sign up form ──────────────────────────────────────────────────────────────

interface SignupFormProps {
  onSwitchToLogin: () => void;
}

function SignupForm({ onSwitchToLogin }: SignupFormProps) {
  const [step, setStep] = useState<SignupStep>('form');
  const [sentEmail, setSentEmail] = useState('');

  if (step === 'verify') {
    return <VerifyStep email={sentEmail} onBack={() => setStep('form')} onSwitchToLogin={onSwitchToLogin} />;
  }

  return <SignupFormFields onSent={(email) => { setSentEmail(email); setStep('verify'); }} onSwitchToLogin={onSwitchToLogin} />;
}

// ── Sign up fields ────────────────────────────────────────────────────────────

function SignupFormFields({ onSent, onSwitchToLogin }: { onSent: (email: string) => void; onSwitchToLogin: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/api/auth/student/signup', { name, email, password });
      onSent(email);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-space-md">
      <AuthField label="Full Name" htmlFor="signup-name">
        <input
          id="signup-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Juan dela Cruz"
          required
          className="auth-input pr-10"
        />
        <MaterialIcon name="badge" />
      </AuthField>

      <AuthField label="Email Address" htmlFor="signup-email">
        <input
          id="signup-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="student@school.edu.ph"
          required
          className="auth-input pr-10"
        />
        <MaterialIcon name="mail" />
      </AuthField>

      <AuthField label="Password" htmlFor="signup-password">
        <input
          id="signup-password"
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Min. 8 characters"
          required
          minLength={8}
          className="auth-input pr-10"
        />
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          aria-label="Toggle password visibility"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-outline hover:text-on-surface focus:outline-none"
        >
          <MaterialIcon name={showPassword ? 'visibility_off' : 'visibility'} />
        </button>
      </AuthField>

      {error && <p className="font-body-sm text-error -mt-1">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-primary text-on-primary py-3.5 px-6 rounded-full font-label-lg text-[14px] shadow-sm hover:opacity-95 active:scale-[0.99] transition-all flex items-center justify-center gap-2 mt-space-xs disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? (
          <Spinner className="text-on-primary" />
        ) : (
          <>
            <span>Create account</span>
            <span className="material-symbols-outlined text-[16px] leading-none">arrow_forward</span>
          </>
        )}
      </button>

      <div className="flex items-center justify-center mt-space-xs">
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="font-body-md text-on-surface-variant hover:text-primary transition-colors focus:outline-none py-1"
        >
          Already have an account?{' '}
          <span className="font-label-md text-primary underline underline-offset-4 ml-1">
            Log in
          </span>
        </button>
      </div>
    </form>
  );
}

// ── Verify step (shown after signup) ─────────────────────────────────────────

function VerifyStep({ email, onBack, onSwitchToLogin }: { email: string; onBack: () => void; onSwitchToLogin: () => void }) {
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSent, setResendSent] = useState(false);

  async function handleResend() {
    setResendSent(false);
    setResendLoading(true);
    try {
      await api.post('/api/auth/student/send-verification', { email });
      setResendSent(true);
      setTimeout(() => setResendSent(false), 5000);
    } catch {
      // silent
    } finally {
      setResendLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-space-md text-center">
      <div className="flex items-center justify-center w-14 h-14 rounded-full bg-primary-fixed mx-auto">
        <span
          className="material-symbols-outlined text-primary"
          style={{ fontSize: 26, fontVariationSettings: "'FILL' 1" }}
        >
          mark_email_unread
        </span>
      </div>

      <div>
        <h2 className="font-headline-md text-on-surface">Check your email</h2>
        <p className="font-body-md text-on-surface-variant mt-1">
          We sent a verification link to{' '}
          <strong className="text-on-surface">{email}</strong>.
          Tap the link to activate your account.
        </p>
      </div>

      <div className="bg-surface-container-low rounded-xl p-space-md text-left border border-outline-variant/30 flex items-start gap-2">
        <span className="material-symbols-outlined text-outline shrink-0 mt-0.5" style={{ fontSize: 18 }}>
          schedule
        </span>
        <p className="font-body-sm text-on-surface-variant">
          Link expires in <strong className="text-on-surface">1 hour</strong>. Check your spam folder if you don&apos;t see it.
        </p>
      </div>

      {resendSent ? (
        <p className="font-body-sm text-primary">✓ A new link was sent.</p>
      ) : (
        <button
          type="button"
          onClick={handleResend}
          disabled={resendLoading}
          className="w-full h-11 border border-outline-variant rounded-full font-label-lg text-on-surface hover:bg-surface-container active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {resendLoading ? <Spinner /> : 'Resend verification email'}
        </button>
      )}

      <div className="flex flex-col gap-1">
        <button type="button" onClick={onBack} className="font-body-md text-on-surface-variant hover:text-primary transition-colors focus:outline-none">
          ← Use a different email
        </button>
        <button type="button" onClick={onSwitchToLogin} className="font-body-md text-primary hover:opacity-80 transition-opacity focus:outline-none">
          Already verified? Log in
        </button>
      </div>
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function AuthField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="font-label-sm text-[11px] text-on-surface-variant px-1">
        {label}
      </label>
      <div className="relative flex items-center">{children}</div>
    </div>
  );
}

function MaterialIcon({ name }: { name: string }) {
  return (
    <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-outline text-[18px] leading-none pointer-events-none">
      {name}
    </span>
  );
}
