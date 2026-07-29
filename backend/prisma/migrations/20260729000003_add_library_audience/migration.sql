-- Phase 2 Migration 3: add_library_audience
-- Creates LibraryAudience table. Additive only.

CREATE TABLE "LibraryAudience" (
    "id"         TEXT         NOT NULL,
    "materialId" TEXT         NOT NULL,
    "targetType" TEXT         NOT NULL,
    "canonical"  TEXT,
    "year"       TEXT,
    "semester"   TEXT,
    "section"    TEXT,
    "studentId"  TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LibraryAudience_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "LibraryAudience"
    ADD CONSTRAINT "LibraryAudience_materialId_fkey"
    FOREIGN KEY ("materialId") REFERENCES "LibraryMaterial"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LibraryAudience"
    ADD CONSTRAINT "LibraryAudience_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "Student"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "LibraryAudience_materialId_idx"  ON "LibraryAudience"("materialId");
CREATE INDEX "LibraryAudience_canonical_idx"   ON "LibraryAudience"("canonical");
CREATE INDEX "LibraryAudience_studentId_idx"   ON "LibraryAudience"("studentId");
CREATE INDEX "LibraryAudience_targetType_idx"  ON "LibraryAudience"("targetType");
