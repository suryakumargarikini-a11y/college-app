-- Phase 2 Migration 2: add_department_alias
-- Creates DepartmentAlias table + seeds 13 confirmed aliases. Idempotent.

CREATE TABLE "DepartmentAlias" (
    "id"        TEXT         NOT NULL,
    "rawValue"  TEXT         NOT NULL,
    "canonical" TEXT         NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DepartmentAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DepartmentAlias_rawValue_key" ON "DepartmentAlias"("rawValue");
CREATE INDEX "DepartmentAlias_canonical_idx"       ON "DepartmentAlias"("canonical");

INSERT INTO "DepartmentAlias" ("id", "rawValue", "canonical") VALUES
  (gen_random_uuid()::text, 'AIML',                                    'AIML'),
  (gen_random_uuid()::text, 'CSE',                                     'AIML'),
  (gen_random_uuid()::text, 'COMPUTER SCIENCE ENGINEERING',            'AIML'),
  (gen_random_uuid()::text, 'AIDS',                                    'AIDS'),
  (gen_random_uuid()::text, 'ARTIFICIAL INTELLIGENCE AND DATA SCIENCE','AIDS'),
  (gen_random_uuid()::text, 'ECE',                                     'ECE'),
  (gen_random_uuid()::text, 'ELECTRONICS & COMMUNICATION ENGINEERING', 'ECE'),
  (gen_random_uuid()::text, 'IT',                                      'IT'),
  (gen_random_uuid()::text, 'MECH',                                    'MECH'),
  (gen_random_uuid()::text, 'CIVIL',                                   'CIVIL'),
  (gen_random_uuid()::text, 'EEE',                                     'EEE'),
  (gen_random_uuid()::text, 'MBA',                                     'MBA'),
  (gen_random_uuid()::text, 'POLYTECHNIC',                             'POLYTECHNIC')
ON CONFLICT ("rawValue") DO NOTHING;
