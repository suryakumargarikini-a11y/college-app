-- Forward-only repair: preserves existing notifications if a historic deployment
-- recorded the migration but missed this column.
ALTER TABLE "AdminNotification" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "AdminNotification" SET "updatedAt" = COALESCE("updatedAt", "sentAt", CURRENT_TIMESTAMP);
ALTER TABLE "AdminNotification" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "AdminNotification" ALTER COLUMN "updatedAt" SET NOT NULL;

CREATE TABLE "LibraryMaterial" (
  "id" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT,
  "fileName" TEXT NOT NULL, "originalFileName" TEXT NOT NULL, "fileUrl" TEXT NOT NULL,
  "fileType" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "fileSize" INTEGER NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'GENERAL', "subject" TEXT, "branch" TEXT,
  "semester" TEXT, "section" TEXT, "academicYear" TEXT, "uploadedBy" TEXT NOT NULL,
  "uploadedByRole" TEXT NOT NULL, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryMaterial_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LibraryMaterial_fileName_key" ON "LibraryMaterial"("fileName");
CREATE INDEX "LibraryMaterial_isActive_createdAt_idx" ON "LibraryMaterial"("isActive", "createdAt");
CREATE INDEX "LibraryMaterial_branch_semester_section_academicYear_idx" ON "LibraryMaterial"("branch", "semester", "section", "academicYear");
CREATE INDEX "LibraryMaterial_subject_idx" ON "LibraryMaterial"("subject");

CREATE TABLE "LibraryView" (
  "id" TEXT NOT NULL, "studentId" TEXT NOT NULL, "materialId" TEXT NOT NULL,
  "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryView_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LibraryView_studentId_materialId_key" ON "LibraryView"("studentId", "materialId");
CREATE INDEX "LibraryView_materialId_idx" ON "LibraryView"("materialId");
ALTER TABLE "LibraryView" ADD CONSTRAINT "LibraryView_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LibraryView" ADD CONSTRAINT "LibraryView_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "LibraryMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LibraryDownload" (
  "id" TEXT NOT NULL, "studentId" TEXT NOT NULL, "materialId" TEXT NOT NULL,
  "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryDownload_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LibraryDownload_studentId_materialId_key" ON "LibraryDownload"("studentId", "materialId");
CREATE INDEX "LibraryDownload_materialId_idx" ON "LibraryDownload"("materialId");
ALTER TABLE "LibraryDownload" ADD CONSTRAINT "LibraryDownload_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LibraryDownload" ADD CONSTRAINT "LibraryDownload_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "LibraryMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;
