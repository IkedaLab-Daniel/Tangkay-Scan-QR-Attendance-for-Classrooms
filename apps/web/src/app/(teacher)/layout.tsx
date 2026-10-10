'use client';

import React, { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { BottomNav } from '@/components/ui/BottomNav';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { RecentSession } from '@/lib/types';

/**
 * Teacher layout — PageHeader + BottomNav role=teacher.
 * Active tab is inferred from the current pathname.
 * Fetches total pending approval count to show a badge on the Reports tab.
 */
function resolveActiveTab(pathname: string): string {
  if (pathname.includes('/reports')) return 'reports';
  if (pathname.includes('/settings')) return 'settings';
  return 'rooms';
}

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = resolveActiveTab(pathname);
  const [pendingTotal, setPendingTotal] = useState(0);

  useEffect(() => {
    api
      .get<RecentSession[]>('/api/sessions/recent?limit=50')
      .then((sessions) => {
        const total = sessions.reduce((sum, s) => sum + (s.pendingCount ?? 0), 0);
        setPendingTotal(total);
      })
      .catch(() => {});
  }, []);

  const badgeCounts = pendingTotal > 0 ? { reports: pendingTotal } : undefined;

  return (
    <>
      <PageHeader title="TangkayScan" />
      <main className="pt-16 pb-20">{children}</main>
      <BottomNav role="teacher" active={active} badgeCounts={badgeCounts} />
    </>
  );
}
