-- Phase 3 Migration 5: add_exit_pass_return_tracking
-- Adds nullable return tracking columns to ExitPass. All additive, zero drops.

ALTER TABLE "ExitPass"
    ADD COLUMN IF NOT EXISTS "returnedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "returnedBy" TEXT,
    ADD COLUMN IF NOT EXISTS "returnGate" TEXT;
