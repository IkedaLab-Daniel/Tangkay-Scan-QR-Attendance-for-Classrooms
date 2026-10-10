import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: React.ReactNode;
}

export function Input({
  label,
  error,
  hint,
  icon,
  id,
  className = '',
  ...props
}: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label
          htmlFor={inputId}
          className="font-label-md text-on-surface-variant"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={inputId}
          {...props}
          className={[
            'w-full bg-surface-container-low px-3.5 py-3 rounded-xl',
            'border text-on-surface placeholder:text-outline',
            'font-sans text-body-md',
            'transition-all duration-150 outline-none',
            'focus:border-primary focus:ring-2 focus:ring-primary/20',
            error
              ? 'border-error ring-2 ring-error/20'
              : 'border-outline-variant',
            icon ? 'pr-10' : '',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
        />
        {icon && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">
            {icon}
          </span>
        )}
      </div>
      {error && (
        <p className="font-body-sm text-error">{error}</p>
      )}
      {hint && !error && (
        <p className="font-body-sm text-on-surface-variant">{hint}</p>
      )}
    </div>
  );
}
