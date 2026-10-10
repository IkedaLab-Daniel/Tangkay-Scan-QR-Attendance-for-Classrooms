import React from 'react';
import { SproutIcon } from './SproutIcon';
import { Button } from './Button';

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 px-6 text-center">
      <SproutIcon size="lg" className="text-primary-fixed-dim" />
      <div className="flex flex-col gap-1">
        <h2 className="font-headline-sm text-on-surface">{title}</h2>
        {description && (
          <p className="font-body-md text-on-surface-variant max-w-xs">{description}</p>
        )}
      </div>
      {action && (
        <Button variant="secondary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
