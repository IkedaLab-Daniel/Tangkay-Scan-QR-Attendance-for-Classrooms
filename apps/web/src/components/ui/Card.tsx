import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  tint?: 'green' | 'peach' | 'oat' | 'none';
  onClick?: () => void;
  padding?: 'sm' | 'md' | 'lg';
}

const tintClasses: Record<NonNullable<CardProps['tint']>, string> = {
  green: 'bg-[#ecf8ef]',
  peach: 'bg-[#fff3ee]',
  oat: 'bg-[#f5f0e8]',
  none: 'bg-surface-container-lowest',
};

const paddingClasses: Record<NonNullable<CardProps['padding']>, string> = {
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
};

export function Card({
  children,
  className = '',
  tint = 'none',
  onClick,
  padding = 'md',
}: CardProps) {
  const isClickable = typeof onClick === 'function';

  return (
    <div
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onClick();
            }
          : undefined
      }
      className={[
        'rounded-xl shadow-card',
        tintClasses[tint],
        paddingClasses[padding],
        isClickable
          ? 'cursor-pointer active:scale-[0.99] transition-transform duration-150 select-none'
          : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}
