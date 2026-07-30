-- CreateTable
CREATE TABLE IF NOT EXISTS "StudyMaterial" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'LECTURE_NOTE',
    "fileUrl" TEXT,
    "fileName" TEXT,
    "uploadedByAdminId" TEXT,
    "uploadedByName" TEXT,
    "uploadedByRole" TEXT,
    "branch" TEXT DEFAULT '',
    "year" TEXT DEFAULT '',
    "semester" TEXT DEFAULT '',
    "section" TEXT DEFAULT 'ALL',
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LmsAssignment" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT,
    "subjectCode" TEXT,
    "subjectName" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "maxMarks" INTEGER NOT NULL DEFAULT 100,
    "attachmentUrl" TEXT,
    "attachmentName" TEXT,
    "createdByAdminId" TEXT,
    "createdByName" TEXT,
    "createdByRole" TEXT,
    "branch" TEXT DEFAULT '',
    "year" TEXT DEFAULT '',
    "semester" TEXT DEFAULT '',
    "section" TEXT DEFAULT 'ALL',
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LmsSubmission" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "submissionText" TEXT,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "marks" DOUBLE PRECISION,
    "grade" TEXT,
    "feedback" TEXT,
    "gradedAt" TIMESTAMP(3),
    "gradedByAdminId" TEXT,
    "gradedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Achievement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "imageUrl" TEXT,
    "achievementDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "branch" TEXT NOT NULL,
    "participantName" TEXT,
    "createdByAdminId" TEXT,
    "createdByName" TEXT,
    "createdByRole" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StudyMaterial_branch_semester_section_idx" ON "StudyMaterial"("branch", "semester", "section");
CREATE INDEX IF NOT EXISTS "StudyMaterial_subjectId_idx" ON "StudyMaterial"("subjectId");
CREATE INDEX IF NOT EXISTS "StudyMaterial_uploadedByAdminId_idx" ON "StudyMaterial"("uploadedByAdminId");
CREATE INDEX IF NOT EXISTS "StudyMaterial_createdAt_idx" ON "StudyMaterial"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LmsAssignment_branch_semester_section_idx" ON "LmsAssignment"("branch", "semester", "section");
CREATE INDEX IF NOT EXISTS "LmsAssignment_subjectId_idx" ON "LmsAssignment"("subjectId");
CREATE INDEX IF NOT EXISTS "LmsAssignment_dueDate_idx" ON "LmsAssignment"("dueDate");
CREATE INDEX IF NOT EXISTS "LmsAssignment_status_idx" ON "LmsAssignment"("status");
CREATE INDEX IF NOT EXISTS "LmsAssignment_createdByAdminId_idx" ON "LmsAssignment"("createdByAdminId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LmsSubmission_assignmentId_studentId_key" ON "LmsSubmission"("assignmentId", "studentId");
CREATE INDEX IF NOT EXISTS "LmsSubmission_assignmentId_idx" ON "LmsSubmission"("assignmentId");
CREATE INDEX IF NOT EXISTS "LmsSubmission_studentId_idx" ON "LmsSubmission"("studentId");
CREATE INDEX IF NOT EXISTS "LmsSubmission_status_idx" ON "LmsSubmission"("status");
CREATE INDEX IF NOT EXISTS "LmsSubmission_gradedByAdminId_idx" ON "LmsSubmission"("gradedByAdminId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Achievement_branch_idx" ON "Achievement"("branch");
CREATE INDEX IF NOT EXISTS "Achievement_isPublished_idx" ON "Achievement"("isPublished");
CREATE INDEX IF NOT EXISTS "Achievement_category_idx" ON "Achievement"("category");
CREATE INDEX IF NOT EXISTS "Achievement_createdAt_idx" ON "Achievement"("createdAt");

-- AddForeignKey
ALTER TABLE "StudyMaterial" ADD CONSTRAINT "StudyMaterial_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyMaterial" ADD CONSTRAINT "StudyMaterial_uploadedByAdminId_fkey" FOREIGN KEY ("uploadedByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LmsAssignment" ADD CONSTRAINT "LmsAssignment_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LmsAssignment" ADD CONSTRAINT "LmsAssignment_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LmsSubmission" ADD CONSTRAINT "LmsSubmission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "LmsAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LmsSubmission" ADD CONSTRAINT "LmsSubmission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LmsSubmission" ADD CONSTRAINT "LmsSubmission_gradedByAdminId_fkey" FOREIGN KEY ("gradedByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
