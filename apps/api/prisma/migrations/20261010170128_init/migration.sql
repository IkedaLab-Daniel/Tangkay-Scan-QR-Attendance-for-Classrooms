-- CreateEnum
CREATE TYPE "AttendanceMode" AS ENUM ('strict', 'balanced', 'static', 'manual');

-- CreateEnum
CREATE TYPE "QrType" AS ENUM ('rotating', 'static');

-- CreateEnum
CREATE TYPE "GpsPolicy" AS ENUM ('off', 'warn', 'reject');

-- CreateEnum
CREATE TYPE "SelfiePolicy" AS ENUM ('off', 'optional', 'required');

-- CreateEnum
CREATE TYPE "BackgroundType" AS ENUM ('none', 'preset', 'custom');

-- CreateEnum
CREATE TYPE "BackgroundScrim" AS ENUM ('light', 'dark');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('pending', 'granted', 'denied');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('student', 'officer');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('active', 'ended');

-- CreateEnum
CREATE TYPE "AttendanceMethod" AS ENUM ('qr_scan', 'manual');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('approved', 'pending', 'rejected');

-- CreateEnum
CREATE TYPE "LocationFlag" AS ENUM ('verified', 'unverified', 'mismatch');

-- CreateEnum
CREATE TYPE "RiskScore" AS ENUM ('low', 'medium', 'high');

-- CreateTable
CREATE TABLE "teachers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teachers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "invite_code" TEXT NOT NULL,
    "attendance_mode" "AttendanceMode" NOT NULL DEFAULT 'balanced',
    "qr_type" "QrType" NOT NULL DEFAULT 'rotating',
    "static_qr_token" TEXT,
    "anchor_lat" DOUBLE PRECISION,
    "anchor_lng" DOUBLE PRECISION,
    "geofence_radius_m" INTEGER NOT NULL DEFAULT 100,
    "gps_policy" "GpsPolicy" NOT NULL DEFAULT 'warn',
    "selfie_policy" "SelfiePolicy" NOT NULL DEFAULT 'optional',
    "require_manual_approval" BOOLEAN NOT NULL DEFAULT true,
    "session_window" TEXT,
    "background_type" "BackgroundType" NOT NULL DEFAULT 'none',
    "background_preset_id" TEXT,
    "background_image_path" TEXT,
    "background_placeholder" TEXT,
    "background_dim" INTEGER NOT NULL DEFAULT 35,
    "background_blur" INTEGER NOT NULL DEFAULT 0,
    "background_scrim" "BackgroundScrim" NOT NULL DEFAULT 'dark',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "parent_email" TEXT,
    "consent_status" "ConsentStatus" NOT NULL DEFAULT 'pending',
    "magic_link_token_hash" TEXT,
    "magic_link_expires_at" TIMESTAMP(3),
    "join_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_members" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'student',
    "officer_title" TEXT,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "started_by_officer_id" TEXT,
    "origin_lat" DOUBLE PRECISION,
    "origin_lng" DOUBLE PRECISION,
    "origin_accuracy" DOUBLE PRECISION,
    "status" "SessionStatus" NOT NULL DEFAULT 'active',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "method" "AttendanceMethod" NOT NULL DEFAULT 'qr_scan',
    "marked_by_officer_id" TEXT,
    "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'approved',
    "selfie_url" TEXT,
    "student_lat" DOUBLE PRECISION,
    "student_lng" DOUBLE PRECISION,
    "student_accuracy" DOUBLE PRECISION,
    "gps_readings" JSONB,
    "distance_from_origin_m" DOUBLE PRECISION,
    "location_flag" "LocationFlag",
    "risk_score" "RiskScore",
    "risk_signals" JSONB,
    "device_fingerprint" TEXT,
    "ip_address" TEXT,
    "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parent_notified_at" TIMESTAMP(3),

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "teacher_id" TEXT,
    "student_id" TEXT,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "background_reports" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "reported_by_student_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "background_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teachers_email_key" ON "teachers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_invite_code_key" ON "rooms"("invite_code");

-- CreateIndex
CREATE UNIQUE INDEX "students_join_code_key" ON "students"("join_code");

-- CreateIndex
CREATE UNIQUE INDEX "room_members_room_id_student_id_key" ON "room_members"("room_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_session_id_student_id_key" ON "attendance_records"("session_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "attendance_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "background_reports" ADD CONSTRAINT "background_reports_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "background_reports" ADD CONSTRAINT "background_reports_reported_by_student_id_fkey" FOREIGN KEY ("reported_by_student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
