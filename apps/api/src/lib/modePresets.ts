import { AttendanceMode, GpsPolicy, QrType, SelfiePolicy } from '@prisma/client';

export interface ModePreset {
  qr_type: QrType;
  gps_policy: GpsPolicy;
  selfie_policy: SelfiePolicy;
}

const PRESETS: Record<AttendanceMode, ModePreset> = {
  strict:   { qr_type: 'rotating', gps_policy: 'reject', selfie_policy: 'required' },
  balanced: { qr_type: 'rotating', gps_policy: 'warn',   selfie_policy: 'optional' },
  static:   { qr_type: 'static',   gps_policy: 'warn',   selfie_policy: 'optional' },
  manual:   { qr_type: 'static',   gps_policy: 'off',    selfie_policy: 'off'      },
};

export function getModePreset(mode: AttendanceMode): ModePreset {
  return PRESETS[mode];
}
