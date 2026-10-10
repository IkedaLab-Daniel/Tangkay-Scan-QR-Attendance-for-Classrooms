import React from 'react';

/**
 * Auth layout — centered card, no navigation chrome.
 * Used by /login, /register, /join, /verify, etc.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-background px-gutter py-8">
      {children}
    </div>
  );
}
