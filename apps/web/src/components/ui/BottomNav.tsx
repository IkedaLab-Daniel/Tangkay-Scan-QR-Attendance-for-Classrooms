'use client';

import React from 'react';
import Link from 'next/link';

type Role = 'teacher' | 'student' | 'officer';

interface NavItem {
  key: string;
  label: string;
  icon: string; // Material Symbols name
  href: string;
}

const navItems: Record<Role, NavItem[]> = {
  teacher: [
    { key: 'rooms', label: 'Rooms', icon: 'meeting_room', href: '/rooms' },
    { key: 'reports', label: 'Reports', icon: 'bar_chart', href: '/reports' },
    { key: 'settings', label: 'Settings', icon: 'settings', href: '/settings' },
  ],
  student: [
    { key: 'rooms', label: 'Rooms', icon: 'meeting_room', href: '/student/rooms' },
    { key: 'student', label: 'Me', icon: 'person', href: '/student' },
    { key: 'reports', label: 'Reports', icon: 'bar_chart', href: '/student/reports' },
    { key: 'settings', label: 'Settings', icon: 'settings', href: '/student/settings' },
  ],
  officer: [
    { key: 'session', label: 'Session', icon: 'qr_code_scanner', href: '/officer/session' },
    { key: 'manual', label: 'Manual', icon: 'edit_note', href: '/officer/manual' },
    { key: 'settings', label: 'Settings', icon: 'settings', href: '/officer/settings' },
  ],
};

interface BottomNavProps {
  role: Role;
  active: string;
  /** Optional badge counts keyed by nav item key (e.g. { reports: 3 }) */
  badgeCounts?: Record<string, number>;
}

export function BottomNav({ role, active, badgeCounts }: BottomNavProps) {
  const items = navItems[role];

  return (
    <nav
      aria-label="Main navigation"
      className="fixed bottom-0 inset-x-0 z-50 h-16 pb-safe bg-surface/90 backdrop-blur-xl
                 border-t border-outline-variant/30"
    >
      <ul className="flex items-center justify-around h-full px-2">
        {items.map((item) => {
          const isActive = active === item.key;
          const badgeCount = badgeCounts?.[item.key] ?? 0;
          return (
            <li key={item.key} className="flex-1 flex justify-center">
              <Link
                href={item.href}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                className={[
                  'flex flex-col items-center justify-center gap-0.5 rounded-full',
                  'min-w-[4rem] py-1 px-3 transition-colors duration-150',
                  isActive
                    ? 'bg-primary-fixed text-on-primary-fixed'
                    : 'text-on-surface-variant hover:text-on-surface',
                ].join(' ')}
              >
                <span className="relative">
                  <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
                    {item.icon}
                  </span>
                  {badgeCount > 0 && (
                    <span
                      aria-label={`${badgeCount} pending`}
                      className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-error"
                    />
                  )}
                </span>
                <span className="font-label-sm">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
