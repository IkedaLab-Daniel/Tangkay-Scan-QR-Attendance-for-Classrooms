import React from 'react';

interface SpinnerProps {
  className?: string;
}

export function Spinner({ className = '' }: SpinnerProps) {
  return (
    <span
      aria-label="Loading"
      className={[
        'inline-block w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    />
  );
}
