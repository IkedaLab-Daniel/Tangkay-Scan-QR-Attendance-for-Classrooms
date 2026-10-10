'use client';

import React from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { BottomNav } from '@/components/ui/BottomNav';
import { usePathname } from 'next/navigation';

/**
 * Student layout — PageHeader + BottomNav role=student.
 * Active tab is inferred from the current pathname.
 */
function resolveActiveTab(pathname: string): string {
  if (pathname === '/student') return 'student';
  if (pathname.startsWith('/student/reports')) return 'reports';
  if (pathname.startsWith('/student/settings')) return 'settings';
  if (pathname.startsWith('/student/rooms')) return 'rooms';
  return 'rooms';
}

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = resolveActiveTab(pathname);

  return (
    <>
      <PageHeader title="TangkayScan" />
      <main className="pt-16 pb-20">{children}</main>
      <BottomNav role="student" active={active} />
    </>
  );
}
