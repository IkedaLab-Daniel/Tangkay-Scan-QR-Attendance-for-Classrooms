import React from 'react';

export type BadgeVariant =
  | 'strict'
  | 'static'
  | 'balanced'
  | 'manual'
  | 'present'
  | 'absent'
  | 'pending'
  | 'flagged'
  | 'active';

interface BadgeProps {
  variant: BadgeVariant;
  label?: string;
  dot?: boolean;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  strict:   'bg-[#fdecea] text-[#ba1a1a] border-[#f5c2be]',
  static:   'bg-[#e8f0fe] text-[#1a5cb8] border-[#b8d0f5]',
  balanced: 'bg-[#e8f5ec] text-[#126a3a] border-[#b3dfc1]',
  manual:   'bg-[#f3eeff] text-[#5b3fa0] border-[#d4bcf7]',
  present:  'bg-[#e8f5ec] text-[#126a3a] border-[#b3dfc1]',
  absent:   'bg-[#fdecea] text-[#ba1a1a] border-[#f5c2be]',
  pending:  'bg-[#fff3ee] text-[#94492b] border-[#fdd4be]',
  flagged:  'bg-[#fff8e1] text-[#7a5800] border-[#ffe08a]',
  active:   'bg-primary-fixed text-on-primary-fixed border-primary-fixed-dim',
};

const dotColors: Record<BadgeVariant, string> = {
  strict:   'bg-[#ba1a1a]',
  static:   'bg-[#1a5cb8]',
  balanced: 'bg-[#126a3a]',
  manual:   'bg-[#5b3fa0]',
  present:  'bg-[#126a3a]',
  absent:   'bg-[#ba1a1a]',
  pending:  'bg-[#94492b]',
  flagged:  'bg-[#7a5800]',
  active:   'bg-primary',
};

export function Badge({ variant, label, dot, className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full',
        'font-label-sm text-[11px] font-semibold border',
        variantClasses[variant],
        className,
      ].filter(Boolean).join(' ')}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColors[variant]}`}
          aria-hidden="true"
        />
      )}
      {label !== undefined && label}
    </span>
  );
}
