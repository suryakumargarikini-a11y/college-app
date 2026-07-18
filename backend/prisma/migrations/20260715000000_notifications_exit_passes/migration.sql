-- AlterTable
ALTER TABLE "ExitPass" 
ADD COLUMN "exitTime" TIMESTAMP(3),
ADD COLUMN "returnTime" TIMESTAMP(3),
ADD COLUMN "emergencyContact" TEXT,
ADD COLUMN "remarks" TEXT,
ADD COLUMN "adminRemark" TEXT;

-- AlterTable
ALTER TABLE "AdminNotification" 
ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
ADD COLUMN "targetStudentId" TEXT,
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "publishedAt" TIMESTAMP(3),
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "NotificationRead" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRead_studentId_notificationId_key" ON "NotificationRead"("studentId", "notificationId");
CREATE INDEX "NotificationRead_studentId_idx" ON "NotificationRead"("studentId");
CREATE INDEX "NotificationRead_notificationId_idx" ON "NotificationRead"("notificationId");

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "AdminNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNotification" ADD CONSTRAINT "AdminNotification_targetStudentId_fkey" FOREIGN KEY ("targetStudentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "AdminNotification_status_idx" ON "AdminNotification"("status");
CREATE INDEX "AdminNotification_targetStudentId_idx" ON "AdminNotification"("targetStudentId");
