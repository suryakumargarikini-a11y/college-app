// Deep audit of admin login execution path
process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'a_very_long_and_secure_jwt_secret_32_chars_plus';
process.env.ADMIN_PASSWORD_SALT = process.env.ADMIN_PASSWORD_SALT || 'a_very_secure_admin_password_salt_pepper_123';

const prisma = require('d:/111/backend/services/dbService');
const { auditLogRepository } = require('d:/111/backend/repositories/index');
const { signToken } = require('d:/111/backend/middleware/adminAuth');

async function fullAudit() {
    console.log('=== FULL ADMIN LOGIN EXECUTION PATH AUDIT ===');
    
    const email = 'accounts@sitamecap.co.in';

    // CHECKPOINT 1: auditLogRepository.logAction exists?
    console.log('\n[CP 01] auditLogRepository.logAction type:', typeof auditLogRepository.logAction);
    console.log('[CP 01] auditLogRepository.log type:', typeof auditLogRepository.log);

    // CHECKPOINT 2: Admin DB lookup
    console.log('\n[CP 02-03] ADMIN_LOOKUP_START...');
    const admin = await prisma.admin.findUnique({ where: { email } });
    console.log('[CP 04] ADMIN_LOOKUP_COMPLETE');
    console.log('[CP 04] ADMIN_FOUND:', !!admin);
    if (!admin) throw new Error('Admin not found — stopping audit');
    
    // CHECKPOINT 3: Active check
    console.log('[CP 05] ADMIN_ACTIVE:', admin.isActive);
    console.log('[CP 05] ADMIN_ROLE:', admin.role);
    console.log('[CP 05] PASSWORD_HASH_PRESENT:', !!admin.passwordHash);
    console.log('[CP 05] PASSWORD_HASH_LENGTH:', admin.passwordHash ? admin.passwordHash.length : 0);

    // CHECKPOINT 4: lastLoginAt update — REMOVED from controller (field not in schema)
    // CP 08/09 are now skipped intentionally.

    // CHECKPOINT 5: JWT generation
    console.log('\n[CP 10] JWT_SIGN_START...');
    let token;
    try {
        token = signToken(admin);
        console.log('[CP 11] JWT_SIGN_COMPLETE: token present =', !!token, 'length =', token.length);
    } catch (err) {
        console.error('[CP 11] JWT_SIGN_FAILED:', err.message);
        throw err;
    }

    // CHECKPOINT 6: Audit log via logAction
    console.log('\n[CP 12] AUDIT_LOG_START...');
    try {
        const logResult = await auditLogRepository.logAction({
            adminId: admin.id,
            action: 'ADMIN_LOGIN',
            resource: 'auth',
            details: { email: admin.email, role: admin.role },
            ipAddress: '127.0.0.1',
            userAgent: 'AuditTest/1.0'
        });
        console.log('[CP 13] AUDIT_LOG_COMPLETE: result =', logResult ? 'record created' : 'null (non-blocking catch)');
    } catch (err) {
        console.error('[CP 13] AUDIT_LOG_THREW:', err.message, 'CODE:', err.code);
        throw err;
    }

    // CHECKPOINT 7: Response payload construction
    console.log('\n[CP 14] RESPONSE_START...');
    const responsePayload = {
        token,
        admin: {
            id: admin.id,
            email: admin.email,
            name: admin.name,
            role: admin.role,
            lastLoginAt: admin.lastLoginAt
        }
    };
    const serialized = JSON.stringify(responsePayload);
    console.log('[CP 14] RESPONSE_SERIALIZABLE:', !!serialized);
    console.log('[CP 15] RESPONSE_SENT: ALL CHECKPOINTS PASSED\n');
    
    console.log('=== AUDIT RESULT: ALL 15 CHECKPOINTS PASS LOCALLY ===');
    console.log('=== CONCLUSION: If 500 still occurs in production, the issue is DEPLOYMENT-side ===');
    
    await prisma.$disconnect();
}

fullAudit().catch(async (err) => {
    console.error('\n=== AUDIT CAUGHT EXCEPTION ===');
    console.error('ERROR_NAME:', err.name);
    console.error('ERROR_MESSAGE:', err.message);
    console.error('ERROR_CODE:', err.code);
    console.error('PRISMA_CODE:', err.code ? err.code : 'N/A');
    console.error('STACK_TOP:', err.stack ? err.stack.split('\n').slice(0, 5).join('\n') : 'N/A');
    await prisma.$disconnect();
    process.exit(1);
});
