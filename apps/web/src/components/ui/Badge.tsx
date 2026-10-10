import React from 'react';

export type BadgeVariant =
  | 'present'
  | 'pending'
  | 'absent'
  | 'strict'
  | 'balanced'
  | 'static'
  | 'manual'
  | 'active'
  | 'flagged'
  | 'review';

interface BadgeProps {
  variant: BadgeVariant;
  label?: string;
  dot?: boolean;
}

const defaultLabels: Record<BadgeVariant, string> = {
  present: 'Present',
  pending: 'Pending',
  absent: 'Absent',
  strict: 'Strict',
  balanced: 'Balanced',
  static: 'Static',
  manual: 'Manual',
  active: 'Active',
  flagged: 'Flagged',
  review: 'Review',
};

const variantClasses: Record<BadgeVariant, string> = {
  present: 'bg-primary-fixed text-on-primary-fixed',
  active: 'bg-primary-fixed text-on-primary-fixed',
  balanced: 'bg-primary-fixed text-on-primary-fixed',
  pending: 'bg-secondary-fixed text-on-secondary-fixed',
  absent: 'bg-error-container text-on-error-container',
  flagged: 'bg-error-container text-on-error-container',
  strict: 'bg-on-surface text-surface',
  static: 'bg-surface-container-highest text-on-surface-variant',
  review: 'bg-secondary-fixed-dim text-on-secondary-fixed',
  manual: 'bg-tertiary-fixed text-on-tertiary-fixed',
};

export function Badge({ variant, label, dot = false }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5',
        'font-label-sm whitespace-nowrap',
        variantClasses[variant],
      ].join(' ')}
    >
      {dot && (
        <span
          className={[
            'w-1.5 h-1.5 rounded-full animate-pulse shrink-0',
            variant === 'absent' || variant === 'flagged'
              ? 'bg-on-error-container'
              : 'bg-current',
          ].join(' ')}
        />
      )}
      {label ?? defaultLabels[variant]}
    </span>
  );
}
