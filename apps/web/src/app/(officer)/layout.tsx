'use client';

import React from 'react';
import { BottomNav } from '@/components/ui/BottomNav';
import { usePathname } from 'next/navigation';

/**
 * Officer layout — BottomNav role=officer.
 * Active tab is inferred from the current pathname.
 * The live session and manual check-in screens manage their own headers and padding;
 * the bottom nav is suppressed for those full-screen routes.
 */
function resolveActiveTab(pathname: string): string {
  if (pathname.startsWith('/officer/manual')) return 'manual';
  if (pathname.startsWith('/officer/settings')) return 'settings';
  return 'session';
}

function shouldShowNav(pathname: string): boolean {
  // Suppress bottom nav on live session and manual pages (they are full-screen)
  if (/\/officer\/session\/[^/]+\/live/.test(pathname)) return false;
  return true;
}

export default function OfficerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = resolveActiveTab(pathname);
  const showNav = shouldShowNav(pathname);

  return (
    <>
      <main className={showNav ? 'pb-20' : ''}>{children}</main>
      {showNav && <BottomNav role="officer" active={active} />}
    </>
  );
}
