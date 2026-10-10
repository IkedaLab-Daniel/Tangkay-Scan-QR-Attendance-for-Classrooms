import React from 'react';

interface SproutIconProps {
  size?: 'sm' | 'lg';
  className?: string;
}

export function SproutIcon({ size = 'sm', className = '' }: SproutIconProps) {
  const dim = size === 'sm' ? 24 : 48;

  return (
    <svg
      width={dim}
      height={dim}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="TangkayScan sprout"
      className={className}
    >
      {/* Stem */}
      <path
        d="M12 20V10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Left leaf */}
      <path
        d="M12 14C12 14 9 13 8 10C8 10 10.5 9 12 11"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.15"
      />
      {/* Right leaf */}
      <path
        d="M12 11C13.5 9 16 10 16 10C15 13 12 14 12 14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.15"
      />
      {/* Soil / ground base */}
      <path
        d="M9 20H15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
