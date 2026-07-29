-- Phase 2 Migration 4: add_library_fields
-- Adds nullable columns to LibraryMaterial. All additive. No drops or renames.

ALTER TABLE "LibraryMaterial"
    ADD COLUMN IF NOT EXISTS "expiresAt"         TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "uploadedByAdminId" TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'LibraryMaterial_uploadedByAdminId_fkey'
    ) THEN
        ALTER TABLE "LibraryMaterial"
            ADD CONSTRAINT "LibraryMaterial_uploadedByAdminId_fkey"
            FOREIGN KEY ("uploadedByAdminId") REFERENCES "Admin"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS "LibraryMaterial_uploadedByAdminId_idx" ON "LibraryMaterial"("uploadedByAdminId");
CREATE INDEX IF NOT EXISTS "LibraryMaterial_expiresAt_idx"         ON "LibraryMaterial"("expiresAt");