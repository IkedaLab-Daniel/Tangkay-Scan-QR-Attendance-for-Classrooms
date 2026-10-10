import React from 'react';
import { Badge } from './Badge';

type StatusPillVariant = 'present' | 'absent' | 'late' | 'pending' | 'flagged';

interface StatusPillProps {
  variant: StatusPillVariant;
  label?: string;
  dot?: boolean;
}

// Map late → pending styling (warm peach) since there's no dedicated 'late' badge color
const variantMap: Record<StatusPillVariant, 'present' | 'pending' | 'absent' | 'flagged'> = {
  present: 'present',
  absent: 'absent',
  late: 'pending',
  pending: 'pending',
  flagged: 'flagged',
};

const defaultLabels: Record<StatusPillVariant, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  pending: 'Pending',
  flagged: 'Flagged',
};

export function StatusPill({ variant, label, dot }: StatusPillProps) {
  return (
    <Badge
      variant={variantMap[variant]}
      label={label ?? defaultLabels[variant]}
      dot={dot}
    />
  );
}
