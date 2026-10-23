'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { SproutIcon } from './SproutIcon';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  back?: boolean;
  action?: React.ReactNode;
}

export function PageHeader({ title, subtitle, back = false, action }: PageHeaderProps) {
  const router = useRouter();

  return (
    <header className="fixed top-0 w-full z-50 bg-surface/85 backdrop-blur-xl h-16 pt-safe px-margin border-b-2 border-primary/50 ">
      <div className="flex items-center justify-between h-16">
        {/* Left: back arrow or sprout logo */}
        <div className="flex items-center gap-2 min-w-0">
          {back ? (
            <button
              onClick={() => router.back()}
              aria-label="Go back"
              className="flex items-center justify-center w-9 h-9 -ml-2 rounded-full
                         text-on-surface hover:bg-surface-container active:bg-surface-container-high
                         transition-colors duration-150"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
                arrow_back
              </span>
            </button>
          ) : (
            <SproutIcon size="sm" className="text-primary shrink-0" />
          )}

          <div className="min-w-0">
            <h1 className="font-headline-sm text-on-surface truncate leading-tight">{title}</h1>
            {subtitle && (
              <p className="font-body-sm text-on-surface-variant truncate leading-tight">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* Right: action slot */}
        {action && <div className="flex items-center gap-2 shrink-0 ml-3">{action}</div>}
      </div>
    </header>
  );
}
