-- Migration: add_extended_profile_fields
-- Adds 11 new profile fields discovered in SITAM ERP BIO-DATA section.
-- Excluded: department (mapped from branch in API), bankAccountNo/rationCardNo (privacy).

ALTER TABLE "Student"
  ADD COLUMN IF NOT EXISTS "apaarId"              TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "motherMobile"         TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "annualIncome"         TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "fatherEmail"          TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "motherEmail"          TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "fatherOccupation"     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "motherOccupation"     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "correspondenceAddress" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "lastStudied"          TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "sgpa"                 TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "academicYear"         TEXT NOT NULL DEFAULT '';
