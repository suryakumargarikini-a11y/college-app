'use strict';
const prisma = require('./dbService');
const logger = require('./logger');

const CANONICAL_DEPARTMENT_MAP = Object.freeze({
    AIML: ['AIML', 'CSE', 'COMPUTER SCIENCE ENGINEERING'],
    AIDS: ['AIDS', 'ARTIFICIAL INTELLIGENCE AND DATA SCIENCE'],
    ECE:  ['ECE', 'ELECTRONICS & COMMUNICATION ENGINEERING'],
    IT:   ['IT'],
    MECH: ['MECH'],
    CIVIL:['CIVIL'],
    EEE:  ['EEE'],
    MBA:  ['MBA'],
    POLYTECHNIC: ['POLYTECHNIC']
});

const ALL_CANONICAL_DEPARTMENTS = Object.keys(CANONICAL_DEPARTMENT_MAP);

// Build reverse lookup map for fast canonicalization
const REVERSE_ALIAS_MAP = {};
for (const [canonical, aliases] of Object.entries(CANONICAL_DEPARTMENT_MAP)) {
    for (const alias of aliases) {
        REVERSE_ALIAS_MAP[alias.toUpperCase()] = canonical;
    }
}

/**
 * Converts any raw branch string into its canonical department key.
 * Example: 'CSE' -> 'AIML', 'COMPUTER SCIENCE ENGINEERING' -> 'AIML', 'ECE' -> 'ECE'
 */
function canonicalizeBranch(rawBranch) {
    if (!rawBranch) return '';
    const clean = rawBranch.trim().toUpperCase();
    return REVERSE_ALIAS_MAP[clean] || clean;
}

/**
 * Returns all raw branch aliases associated with a set of canonical department keys.
 */
function getRawAliasesForCanonicals(canonicals) {
    const rawSet = new Set();
    for (const canon of canonicals) {
        const aliases = CANONICAL_DEPARTMENT_MAP[canon];
        if (aliases) {
            aliases.forEach(a => rawSet.add(a));
        } else {
            rawSet.add(canon);
        }
    }
    return Array.from(rawSet);
}

/**
 * Resolves all authorized canonical department keys and raw branch aliases for a staff member.
 * - SUPER_ADMIN, DEAN, CI: Access to ALL 9 canonical departments and aliases.
 * - HOD: Access determined by StaffScope DB records. If AIML or CSE is present, expands to AIML scope (AIML + CSE).
 * - HOSTEL_WARDEN: Academic scope is N/A; hostel filtering handled separately.
 */
async function getAuthorizedDepartments(admin) {
    if (!admin || !admin.role) {
        return { canonicals: [], rawAliases: [] };
    }

    const role = admin.role;

    if (role === 'SUPER_ADMIN' || role === 'DEAN' || role === 'CI') {
        const canonicals = ALL_CANONICAL_DEPARTMENTS;
        const rawAliases = getRawAliasesForCanonicals(canonicals);
        return { canonicals, rawAliases };
    }

    if (role === 'HOD') {
        let scopes = [];
        if (admin.id) {
            try {
                scopes = await prisma.staffScope.findMany({
                    where: { adminId: admin.id, scopeType: 'DEPARTMENT' },
                    select: { scopeValue: true }
                });
            } catch (err) {
                logger.error(`[StaffScopeService] Error fetching scopes for ${admin.id}: ${err.message}`);
            }
        }

        const canonicalSet = new Set();
        for (const s of scopes) {
            const canon = canonicalizeBranch(s.scopeValue);
            canonicalSet.add(canon);
        }

        // AIML HOD scope rule: AIML HOD controls BOTH AIML and CSE
        if (canonicalSet.has('AIML') || canonicalSet.has('CSE')) {
            canonicalSet.add('AIML');
        }

        const canonicals = Array.from(canonicalSet);
        const rawAliases = getRawAliasesForCanonicals(canonicals);
        return { canonicals, rawAliases };
    }

    // Default fallback (e.g. FACULTY or other roles without custom staff scopes)
    return { canonicals: [], rawAliases: [] };
}

/**
 * Synchronously checks if a staff member can access a raw branch given their resolved canonical scopes.
 */
function canAccessBranchWithScopes(authorizedCanonicals, rawBranch) {
    if (!rawBranch) return false;
    const targetCanon = canonicalizeBranch(rawBranch);
    return authorizedCanonicals.includes(targetCanon);
}

/**
 * Asynchronously checks if a staff member can access a student based on department scope and role constraints.
 */
async function canAccessStudent(admin, student) {
    if (!admin || !student) return false;

    if (admin.role === 'SUPER_ADMIN' || admin.role === 'DEAN' || admin.role === 'CI') {
        return true;
    }

    if (admin.role === 'HOSTEL_WARDEN') {
        return !!(student.hostel && student.hostel.trim() !== '');
    }

    const { canonicals } = await getAuthorizedDepartments(admin);
    return canAccessBranchWithScopes(canonicals, student.branch);
}

/**
 * Returns a Prisma WHERE clause for filtering student queries by staff scope.
 */
async function getStudentScopeWhereClause(admin) {
    if (!admin || !admin.role) {
        return { id: 'impossibility-no-access' };
    }

    const role = admin.role;

    if (role === 'SUPER_ADMIN' || role === 'DEAN' || role === 'CI') {
        return {};
    }

    if (role === 'HOSTEL_WARDEN') {
        return {
            hostel: {
                notIn: ['', 'no', 'NO', 'No', 'none', 'NONE', 'day scholar', 'Day Scholar']
            }
        };
    }

    const { rawAliases } = await getAuthorizedDepartments(admin);
    if (rawAliases.length === 0) {
        return { id: 'impossibility-no-scope' };
    }

    return {
        branch: { in: rawAliases }
    };
}

/**
 * Verifies staff access to a student, throwing a 403 error if outside authorized scope.
 */
async function verifyStudentAccessOrThrow(admin, student) {
    const allowed = await canAccessStudent(admin, student);
    if (!allowed) {
        const error = new Error(`Forbidden: Staff member '${admin.email || admin.id}' lacks authorization for student in branch '${student.branch || 'unknown'}'`);
        error.status = 403;
        throw error;
    }
}

module.exports = {
    CANONICAL_DEPARTMENT_MAP,
    ALL_CANONICAL_DEPARTMENTS,
    canonicalizeBranch,
    getRawAliasesForCanonicals,
    getAuthorizedDepartments,
    canAccessBranchWithScopes,
    canAccessStudent,
    getStudentScopeWhereClause,
    verifyStudentAccessOrThrow
};