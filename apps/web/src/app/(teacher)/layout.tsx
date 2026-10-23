'use client';

import React, { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { BottomNav } from '@/components/ui/BottomNav';
import { TeacherSidebar } from '@/components/TeacherSidebar';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { RecentSession } from '@/lib/types';

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
    <div className="flex min-h-screen bg-background">
      {/* ── Desktop sidebar (hidden on mobile) ── */}
      <TeacherSidebar badgeCounts={badgeCounts} />

      {/* ── Main content area ── */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Mobile-only top header */}
        <div className="lg:hidden">
          <PageHeader title="TangkayScan" />
        </div>

        {/* Page content */}
        <main className="flex-1 pt-16 pb-20 lg:pt-0 lg:pb-0">
          {children}
        </main>
      </div>

      {/* ── Mobile bottom nav (hidden on desktop) ── */}
      <div className="lg:hidden">
        <BottomNav role="teacher" active={active} badgeCounts={badgeCounts} />
      </div>
    </div>
  );
}
