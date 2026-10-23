'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SproutIcon } from '@/components/ui/SproutIcon';

interface NavItem {
  key: string;
  label: string;
  icon: string;
  href: string;
}

const teacherNav: NavItem[] = [
  { key: 'rooms',   label: 'Rooms',   icon: 'meeting_room', href: '/teacher/rooms' },
  { key: 'reports', label: 'Reports', icon: 'bar_chart',    href: '/teacher/reports' },
];

function resolveActive(pathname: string): string {
  if (pathname.includes('/reports')) return 'reports';
  return 'rooms';
}

interface TeacherSidebarProps {
  badgeCounts?: Record<string, number>;
}

export function TeacherSidebar({ badgeCounts }: TeacherSidebarProps) {
  const pathname = usePathname();
  const active = resolveActive(pathname);

  return (
    <aside className="hidden lg:flex flex-col w-60 shrink-0 h-screen sticky top-0 border-r border-outline-variant/40 bg-sidebar">
      {/* Brand */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-outline-variant/30">
        <SproutIcon size="sm" className="text-primary shrink-0" />
        <div className="flex flex-col leading-tight">
          <span className="font-headline text-label-lg text-on-surface font-semibold">
            TangkayScan
          </span>
          <span className="font-sans text-[11px] text-on-surface-variant">
            Teacher Dashboard
          </span>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex flex-col gap-1 px-3 py-4 flex-1">
        {teacherNav.map((item) => {
          const isActive = active === item.key;
          const badge = badgeCounts?.[item.key] ?? 0;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={[
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-label-lg transition-colors duration-150',
                isActive
                  ? 'bg-primary text-on-primary font-semibold'
                  : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
              ].join(' ')}
            >
              <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {badge > 0 && (
                <span className="min-w-[1.25rem] h-5 px-1 rounded-full bg-error text-on-error text-[11px] font-bold flex items-center justify-center">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer hint */}
      <div className="px-6 py-4 border-t border-outline-variant/30">
        <p className="text-[11px] text-on-surface-variant/60 leading-relaxed">
          TangkayScan · Teacher
        </p>
      </div>
    </aside>
  );
}
