-- Phase 2 Migration 1: add_staff_scope
-- Creates StaffScope table. Additive only.

CREATE TABLE "StaffScope" (
    "id"         TEXT         NOT NULL,
    "adminId"    TEXT         NOT NULL,
    "scopeType"  TEXT         NOT NULL DEFAULT 'DEPARTMENT',
    "scopeValue" TEXT         NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffScope_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "StaffScope"
    ADD CONSTRAINT "StaffScope_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "Admin"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "StaffScope_adminId_scopeType_scopeValue_key"
    ON "StaffScope"("adminId", "scopeType", "scopeValue");

CREATE INDEX "StaffScope_adminId_idx"    ON "StaffScope"("adminId");
CREATE INDEX "StaffScope_scopeValue_idx" ON "StaffScope"("scopeValue");
