'use strict';

/**
 * seedStaff.js
 * SITAM Smart ERP — Idempotent Institutional Staff Account Provisioning
 *
 * Provisions approved staff accounts (9 HODs, 2 Deans, 1 CI, 1 Hostel Warden)
 * and seeds their StaffScope rules.
 *
 * Credential Security:
 *  - Reads credentials strictly from environment variables.
 *  - Fails safely (skips) if an account's environment variables are missing.
 *  - Never logs or exposes plaintext passwords.
 *  - Uses existing SHA256-HMAC password hashing.
 */

const crypto = require('crypto');
const prisma = require('../services/dbService');
const logger = require('../services/logger');

const ALL_CANONICAL_DEPTS = [
    'AIML', 'AIDS', 'ECE', 'IT', 'MECH', 'CIVIL', 'EEE', 'MBA', 'POLYTECHNIC'
];

/**
 * Hash password using existing ADMIN_PASSWORD_SALT pepper.
 */
function hashPassword(password) {
    const salt = process.env.ADMIN_PASSWORD_SALT || 'sitam-admin-salt-test-key-32-chars';
    return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

/**
 * Specification for the 13 approved institutional staff accounts.
 */
const STAFF_SPECIFICATIONS = [
    // ── 9 HOD Accounts ────────────────────────────────────────────────────────
    {
        key: 'HOD_AIML',
        role: 'HOD',
        defaultName: 'HOD AIML',
        emailEnv: 'HOD_AIML_EMAIL',
        passwordEnv: 'HOD_AIML_PASSWORD',
        scopes: ['AIML']
    },
    {
        key: 'HOD_AIDS',
        role: 'HOD',
        defaultName: 'HOD AIDS',
        emailEnv: 'HOD_AIDS_EMAIL',
        passwordEnv: 'HOD_AIDS_PASSWORD',
        scopes: ['AIDS']
    },
    {
        key: 'HOD_ECE',
        role: 'HOD',
        defaultName: 'HOD ECE',
        emailEnv: 'HOD_ECE_EMAIL',
        passwordEnv: 'HOD_ECE_PASSWORD',
        scopes: ['ECE']
    },
    {
        key: 'HOD_IT',
        role: 'HOD',
        defaultName: 'HOD IT',
        emailEnv: 'HOD_IT_EMAIL',
        passwordEnv: 'HOD_IT_PASSWORD',
        scopes: ['IT']
    },
    {
        key: 'HOD_MECH',
        role: 'HOD',
        defaultName: 'HOD MECH',
        emailEnv: 'HOD_MECH_EMAIL',
        passwordEnv: 'HOD_MECH_PASSWORD',
        scopes: ['MECH']
    },
    {
        key: 'HOD_CIVIL',
        role: 'HOD',
        defaultName: 'HOD CIVIL',
        emailEnv: 'HOD_CIVIL_EMAIL',
        passwordEnv: 'HOD_CIVIL_PASSWORD',
        scopes: ['CIVIL']
    },
    {
        key: 'HOD_EEE',
        role: 'HOD',
        defaultName: 'HOD EEE',
        emailEnv: 'HOD_EEE_EMAIL',
        passwordEnv: 'HOD_EEE_PASSWORD',
        scopes: ['EEE']
    },
    {
        key: 'HOD_MBA',
        role: 'HOD',
        defaultName: 'HOD MBA',
        emailEnv: 'HOD_MBA_EMAIL',
        passwordEnv: 'HOD_MBA_PASSWORD',
        scopes: ['MBA']
    },
    {
        key: 'HOD_POLYTECHNIC',
        role: 'HOD',
        defaultName: 'HOD POLYTECHNIC',
        emailEnv: 'HOD_POLYTECHNIC_EMAIL',
        passwordEnv: 'HOD_POLYTECHNIC_PASSWORD',
        scopes: ['POLYTECHNIC']
    },

    // ── 2 Leadership Accounts ──────────────────────────────────────────────────
    {
        key: 'DEAN_1',
        role: 'DEAN',
        defaultName: 'Dean Academics 1',
        emailEnv: 'DEAN_1_EMAIL',
        passwordEnv: 'DEAN_1_PASSWORD',
        scopes: ALL_CANONICAL_DEPTS
    },
    {
        key: 'DEAN_2',
        role: 'DEAN',
        defaultName: 'Dean Academics 2',
        emailEnv: 'DEAN_2_EMAIL',
        passwordEnv: 'DEAN_2_PASSWORD',
        scopes: ALL_CANONICAL_DEPTS
    },

    // ── 1 Administration Head Account ──────────────────────────────────────────
    {
        key: 'CI',
        role: 'CI',
        defaultName: 'College Administration Head (CI)',
        emailEnv: 'CI_EMAIL',
        passwordEnv: 'CI_PASSWORD',
        scopes: ALL_CANONICAL_DEPTS
    },

    // ── 1 Hostel Warden Account ────────────────────────────────────────────────
    {
        key: 'HOSTEL_WARDEN',
        role: 'HOSTEL_WARDEN',
        defaultName: 'Hostel Warden',
        emailEnv: 'HOSTEL_WARDEN_EMAIL',
        passwordEnv: 'HOSTEL_WARDEN_PASSWORD',
        scopes: [] // Warden access is hostel resident basic details only
    }
];

function sanitizeUrl(rawUrl) {
    if (!rawUrl) return { host: 'NONE', dbName: 'NONE' };
    try {
        const parsed = new URL(rawUrl);
        return {
            host: parsed.hostname || 'UNKNOWN',
            dbName: (parsed.pathname || '').replace(/^\//, '') || 'UNKNOWN'
        };
    } catch (_) {
        return { host: 'INVALID_URL', dbName: 'INVALID_URL' };
    }
}

/**
 * Execute staff account provisioning.
 * Idempotent: safe to run multiple times.
 * Returns sanitized execution summary.
 */
async function seedStaff(options = {}) {
    const silent = options.silent || false;
    const results = [];

    if (!silent) console.log('=== SITAM SMART ERP — STAFF PROVISIONING ===');

    for (const spec of STAFF_SPECIFICATIONS) {
        const email = process.env[spec.emailEnv] || options[spec.emailEnv];
        const password = process.env[spec.passwordEnv] || options[spec.passwordEnv];
        const name = process.env[`${spec.key}_NAME`] || spec.defaultName;

        if (!email || !password) {
            const statusMsg = `SKIPPED (Missing ${spec.emailEnv} or ${spec.passwordEnv})`;
            results.push({ key: spec.key, role: spec.role, status: statusMsg });
            if (!silent) console.log(`[seedStaff] ${spec.key} (${spec.role}): ${statusMsg}`);
            continue;
        }

        const normalizedEmail = email.toLowerCase().trim();
        const passwordHash = hashPassword(password);

        try {
            // Upsert Admin record by unique email
            const admin = await prisma.admin.upsert({
                where: { email: normalizedEmail },
                update: {
                    name,
                    role: spec.role,
                    passwordHash,
                    isActive: true
                },
                create: {
                    email: normalizedEmail,
                    passwordHash,
                    name,
                    role: spec.role,
                    isActive: true
                }
            });

            // Upsert StaffScope records
            let scopeCount = 0;
            for (const scopeValue of spec.scopes) {
                await prisma.staffScope.upsert({
                    where: {
                        adminId_scopeType_scopeValue: {
                            adminId: admin.id,
                            scopeType: 'DEPARTMENT',
                            scopeValue: scopeValue
                        }
                    },
                    update: {},
                    create: {
                        adminId: admin.id,
                        scopeType: 'DEPARTMENT',
                        scopeValue: scopeValue
                    }
                });
                scopeCount++;
            }

            const statusMsg = `SUCCESS (Admin ID: ${admin.id}, Scopes: ${scopeCount})`;
            results.push({ key: spec.key, role: spec.role, email: normalizedEmail, scopes: scopeCount, status: 'SUCCESS' });
            if (!silent) console.log(`[seedStaff] ${spec.key} (${spec.role}) -> ${normalizedEmail}: SUCCESS (${scopeCount} scopes)`);

        } catch (err) {
            const errorMsg = `FAILED (${err.message})`;
            results.push({ key: spec.key, role: spec.role, status: errorMsg });
            if (!silent) console.error(`[seedStaff] ${spec.key} (${spec.role}) ERROR: ${err.message}`);
        }
    }

    if (!silent) console.log('=== STAFF PROVISIONING COMPLETED ===');
    return results;
}

if (require.main === module) {
    async function runCli() {
        const rawUrl = process.env.DATABASE_URL || '';
        const { host, dbName } = sanitizeUrl(rawUrl);

        console.log('=== SITAM SMART ERP — PRODUCTION STAFF PROVISIONING CLI ===');
        console.log(`DATABASE_HOST: ${host}`);
        console.log(`DATABASE_NAME: ${dbName}`);

        // 1. Guard against non-Railway target in production
        const isRailwayTarget = host.includes('railway');
        if (process.env.NODE_ENV === 'production' && !isRailwayTarget) {
            console.error(`[ABORT] DATABASE_HOST '${host}' is not Railway production. Provisioning rejected.`);
            process.exit(1);
        }

        // 2. Guard against missing ALLOW_PRODUCTION_SEED flag
        if (process.env.ALLOW_PRODUCTION_SEED !== 'true') {
            console.error('[ABORT] Executing seedStaff CLI in production requires explicit ALLOW_PRODUCTION_SEED=true environment variable.');
            process.exit(1);
        }

        // 3. Credential pre-check: verify all 26 variables
        let presentEnvCount = 0;
        const missingEnvs = [];
        for (const spec of STAFF_SPECIFICATIONS) {
            const email = process.env[spec.emailEnv];
            const pass = process.env[spec.passwordEnv];
            if (email && email.trim() !== '') presentEnvCount++;
            else missingEnvs.push(spec.emailEnv);

            if (pass && pass.trim() !== '') presentEnvCount++;
            else missingEnvs.push(spec.passwordEnv);
        }

        console.log(`CREDENTIAL_VARIABLES_PRESENT_COUNT: ${presentEnvCount}/26`);

        if (missingEnvs.length > 0) {
            console.error(`[ABORT] Cannot provision staff. Missing ${missingEnvs.length} credential environment variables:`, missingEnvs.join(', '));
            process.exit(1);
        }

        // 4. Database Pre-State Audit
        const existingAdminCount = await prisma.admin.count();
        console.log(`EXISTING_ADMIN_COUNT: ${existingAdminCount}`);

        const intendedEmails = STAFF_SPECIFICATIONS.map(s => (process.env[s.emailEnv] || '').toLowerCase().trim()).filter(Boolean);
        const matchingSpecial = await prisma.admin.count({
            where: { email: { in: intendedEmails } }
        });
        console.log(`MATCHING_SPECIAL_ACCOUNTS: ${matchingSpecial}`);

        // 5. Execute Provisioning
        await seedStaff();

        // 6. Post-Provision Audit
        const postAdminCount = await prisma.admin.count();
        const postMatchingSpecial = await prisma.admin.count({
            where: { email: { in: intendedEmails } }
        });
        console.log(`POST_PROVISION_ADMIN_COUNT: ${postAdminCount}`);
        console.log(`POST_PROVISION_SPECIAL_ACCOUNTS: ${postMatchingSpecial}`);
    }

    runCli()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('[seedStaff] Fatal error during CLI provisioning:', err.message);
            process.exit(1);
        });
}

module.exports = { seedStaff, STAFF_SPECIFICATIONS, hashPassword };
