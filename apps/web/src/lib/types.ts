export interface Room {
  id: string;
  name: string;
  subject?: string;
  room_number?: string;
  attendance_mode: string;
  qr_type: string;
  gps_policy: string;
  selfie_policy: string;
  geofence_radius_m: number;
  require_manual_approval: boolean;
  invite_code: string;
  student_count?: number;
  last_session_at?: string | null;
  status?: 'active' | 'idle';
  // Background fields
  background_type?: 'none' | 'preset' | 'custom';
  background_preset_id?: string | null;
  background_image_path?: string | null;
  background_placeholder?: string | null;
  background_dim?: number;
  background_blur?: number;
  background_scrim?: 'light' | 'dark';
  // Static QR
  static_qr_token?: string | null;
  // Anchor
  anchor_lat?: number | null;
  anchor_lng?: number | null;
}

export interface Student {
  id: string;
  name: string;
  email: string;
  parent_email: string | null;
  consent_status: string;
}

export interface RoomMember {
  id: string;
  room_id: string;
  student_id: string;
  role: 'student' | 'officer';
  officer_title: string | null;
  joined_at: string;
  student?: Student;
}

export interface AttendanceSession {
  id: string;
  room_id: string;
  status: 'active' | 'ended';
  started_at: string;
  ended_at: string | null;
  present_count?: number;
  flagged_count?: number;
  pending_count?: number;
}

export interface RecentSession {
  id: string;
  room: { id: string; name: string; attendance_mode: string };
  status: 'active' | 'ended';
  started_at: string;
  ended_at: string | null;
  presentCount: number;
  flaggedCount: number;
  pendingCount: number;
}

export interface AttendanceSummary {
  total: number;
  thisMonth: number;
  streak: number;
  recentRecords: StudentRecord[];
}

export interface StudentRecord {
  id: string;
  session_id: string;
  method: 'qr_scan' | 'manual';
  approval_status: string;
  location_flag: string | null;
  risk_score: string | null;
  scanned_at: string;
  room: { id: string; name: string };
}

export interface AttendanceRecord {
  id: string;
  session_id: string;
  student_id: string;
  method: 'qr_scan' | 'manual';
  approval_status: string;
  location_flag: string;
  risk_score: string;
  risk_signals: string[];
  scanned_at: string;
  student?: Student;
}

export interface ManualRecord {
  id: string;
  session_id: string;
  student_id: string;
  approval_status: 'pending' | 'approved' | 'rejected';
  scanned_at: string;
  student?: { id: string; name: string };
}
