-- AddTable: SyncHistory
-- Replaces anti-pattern of lastSyncRequestId column on Student.
-- Every ERP scrape creates one row, keyed by REQ-XXXXX requestId.
-- A single requestId query returns the complete flow:
--   student → provider → browser → pagesScraped → duration → error

CREATE TABLE "SyncHistory" (
    "id"           TEXT NOT NULL,
    "requestId"    TEXT NOT NULL,
    "studentId"    TEXT NOT NULL,
    "provider"     TEXT NOT NULL,
    "browserId"    TEXT,
    "startedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"  TIMESTAMP(3),
    "status"       TEXT NOT NULL DEFAULT 'RUNNING',
    "durationMs"   INTEGER,
    "pagesScraped" TEXT DEFAULT '{}',
    "error"        TEXT,

    CONSTRAINT "SyncHistory_pkey" PRIMARY KEY ("id")
);

-- SyncHistory.requestId is the primary lookup key — must be unique
CREATE UNIQUE INDEX "SyncHistory_requestId_key" ON "SyncHistory"("requestId");

-- Support queries: by student, by time, by status
CREATE INDEX "SyncHistory_studentId_idx"  ON "SyncHistory"("studentId");
CREATE INDEX "SyncHistory_startedAt_idx"  ON "SyncHistory"("startedAt");
CREATE INDEX "SyncHistory_status_idx"     ON "SyncHistory"("status");

-- Foreign key: cascade delete SyncHistory when Student is deleted
ALTER TABLE "SyncHistory" ADD CONSTRAINT "SyncHistory_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "Student"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
