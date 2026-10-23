'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SproutIcon, Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

type Tab = 'signup' | 'login';

export default function TeacherAuthPage() {
  const router = useRouter();
  const { user, loading, refresh } = useAuth();
  const [tab, setTab] = useState<Tab>('signup');

  // Redirect if already authenticated
  useEffect(() => {
    if (!loading && user?.typ === 'teacher') router.replace('/teacher/rooms');
    if (!loading && user?.typ === 'student') router.replace('/student/rooms');
  }, [user, loading, router]);

  // Called after successful login/signup — refresh auth context THEN navigate
  async function handleAuthSuccess() {
    await refresh();
    router.replace('/teacher/rooms');
  }

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
          Teacher sign-in
        </p>
      </header>

      {/* Auth card */}
      <section className="w-full max-w-[360px] bg-surface-container-lowest rounded-xl shadow-card p-space-lg flex flex-col">
        {/* Segmented tab switcher */}
        <div className="flex p-1 bg-surface-container rounded-xl mb-space-lg" role="tablist">
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
        </div>

        {/* Form */}
        {tab === 'signup' ? (
          <SignUpForm onSuccess={handleAuthSuccess} />
        ) : (
          <LoginForm
            onSuccess={handleAuthSuccess}
            onSwitchToSignup={() => setTab('signup')}
          />
        )}

        {/* Secondary link */}
        <div className="flex items-center justify-center mt-space-lg text-center">
          {tab === 'signup' ? (
            <button
              type="button"
              onClick={() => setTab('login')}
              className="font-body-md text-on-surface-variant hover:text-primary transition-colors focus:outline-none py-1"
            >
              Already have a room?{' '}
              <span className="font-label-md text-primary underline underline-offset-4 ml-1">
                Log in
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setTab('signup')}
              className="font-body-md text-on-surface-variant hover:text-primary transition-colors focus:outline-none py-1"
            >
              New here?{' '}
              <span className="font-label-md text-primary underline underline-offset-4 ml-1">
                Create account
              </span>
            </button>
          )}
        </div>
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

// ── Sign-up form ──────────────────────────────────────────────────────────────

interface SignUpFormProps {
  onSuccess: () => void;
}

function SignUpForm({ onSuccess }: SignUpFormProps) {
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
      await api.post('/api/auth/teacher/signup', { name, email, password });
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-space-md">
      <AuthField label="Teacher Name" htmlFor="signup-name">
        <input
          id="signup-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Guro Maria Santos"
          required
          className="auth-input pr-10"
        />
        <MaterialIcon name="badge" />
      </AuthField>

      <AuthField label="School Email" htmlFor="signup-email">
        <input
          id="signup-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teacher@school.edu.ph"
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
    </form>
  );
}

// ── Login form ────────────────────────────────────────────────────────────────

interface LoginFormProps {
  onSuccess: () => void;
  onSwitchToSignup: () => void;
}

function LoginForm({ onSuccess }: LoginFormProps) {
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
      await api.post('/api/auth/teacher/login', { email, password });
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-space-md">
      <AuthField label="School Email" htmlFor="login-email">
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teacher@school.edu.ph"
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
    </form>
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
