ALTER TABLE "ExitPass" ADD COLUMN "groupRequestId" TEXT;
ALTER TABLE "ExitPass" ADD COLUMN "academicYear" TEXT;
ALTER TABLE "ExitPass" ADD COLUMN "semester" TEXT;
ALTER TABLE "ExitPass" ADD COLUMN "qrTokenHash" TEXT;
ALTER TABLE "ExitPass" ADD COLUMN "exitConfirmedAt" TIMESTAMP(3);
ALTER TABLE "ExitPass" ADD COLUMN "exitConfirmedBy" TEXT;
ALTER TABLE "ExitPass" ADD COLUMN "verificationMethod" TEXT;
ALTER TABLE "ExitPass" ADD COLUMN "parentSmsStatus" TEXT;
ALTER TABLE "ExitPass" ADD COLUMN "parentSmsId" TEXT;
ALTER TABLE "ExitPass" ADD COLUMN "exitGate" TEXT;
ALTER TABLE "ExitPass" ADD COLUMN "identityMismatchReason" TEXT;
ALTER TABLE "ExitPass" ADD COLUMN "otpAttempts" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "GroupExitPassRequest" (
    "id" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "exitTime" TIMESTAMP(3) NOT NULL,
    "returnTime" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "leaderId" TEXT NOT NULL,
    "rejectionNote" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupExitPassRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SmsLog" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "passId" TEXT,
    "type" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsLog_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ExitPass" ADD CONSTRAINT "ExitPass_groupRequestId_fkey" FOREIGN KEY ("groupRequestId") REFERENCES "GroupExitPassRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ExitPass_qrTokenHash_idx" ON "ExitPass"("qrTokenHash");
CREATE INDEX "ExitPass_groupRequestId_idx" ON "ExitPass"("groupRequestId");
CREATE INDEX "ExitPass_exitConfirmedAt_idx" ON "ExitPass"("exitConfirmedAt");
CREATE INDEX "GroupExitPassRequest_status_idx" ON "GroupExitPassRequest"("status");
CREATE INDEX "GroupExitPassRequest_createdAt_idx" ON "GroupExitPassRequest"("createdAt");
