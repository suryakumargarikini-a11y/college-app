'use strict';
const prisma = require('../../services/dbService');
const logger = require('../../services/logger');

const getStats = async (req, res) => {
    try {
        const role = req.admin.role;

        // Fetch counts for all metrics
        const [students, announcements, placements, feeNotices, exitPasses] = await Promise.all([
            prisma.student.count(),
            prisma.announcement.count({ where: { status: 'PUBLISHED' } }),
            prisma.placement.count({ where: { status: 'PUBLISHED' } }),
            prisma.feeNotice.count({ where: { isActive: true } }),
            prisma.exitPass.count({ where: { status: 'PENDING' } })
        ]);

        // Filter the stats cards depending on the administrator's role
        let stats = {};
        if (role === 'SUPER_ADMIN') {
            stats = { students, announcements, placements, feeNotices, pendingExitPasses: exitPasses };
        } else if (role === 'ACCOUNTS_ADMIN') {
            stats = { students, feeNotices };
        } else if (role === 'PLACEMENT_ADMIN') {
            stats = { students, announcements, placements };
        }

        // Fetch recent administrative logs for the timeline (Activity Feed)
        // Filter logs based on role to preserve scope
        let logWhereClause = {};
        if (role === 'ACCOUNTS_ADMIN') {
            logWhereClause = { action: { in: ['FEE_NOTICE_CREATED', 'PASSWORD_CHANGED', 'ADMIN_LOGIN', 'ADMIN_LOGOUT'] } };
        } else if (role === 'PLACEMENT_ADMIN') {
            logWhereClause = { action: { in: ['PLACEMENT_PUBLISHED', 'ANNOUNCEMENT_CREATED', 'PASSWORD_CHANGED', 'ADMIN_LOGIN', 'ADMIN_LOGOUT'] } };
        }

        const recentAuditLogs = await prisma.auditLog.findMany({
            where: logWhereClause,
            orderBy: { timestamp: 'desc' },
            take: 10,
            include: {
                student: { select: { name: true, roll: true } },
                admin: { select: { name: true, email: true, role: true } }
            }
        });

        res.json({
            stats,
            recentActivity: {
                auditLogs: recentAuditLogs
            }
        });
    } catch (err) {
        logger.error('[Dashboard] Stats error:', err);
        res.status(500).json({ error: 'Failed to load dashboard stats' });
    }
};

const getSecurityStats = async (req, res) => {
    try {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        // 1. Exits verified today (marked USED since midnight)
        const exitsVerifiedToday = await prisma.exitPass.count({
            where: {
                status: 'USED',
                verifiedAt: { gte: startOfToday }
            }
        });

        // 2. Currently approved exit passes (not used, not expired)
        const approvedExitsCount = await prisma.exitPass.count({
            where: {
                status: 'APPROVED',
                otpExpiry: { gt: new Date() }
            }
        });

        // 3. Total exit passes recorded in database
        const totalExitsCount = await prisma.exitPass.count();

        // 4. Fetch the 10 most recent exit pass logs
        const recentExits = await prisma.exitPass.findMany({
            orderBy: { updatedAt: 'desc' },
            take: 10,
            include: {
                student: {
                    select: { name: true, roll: true, branch: true, year: true, section: true }
                }
            }
        });

        res.json({
            stats: {
                exitsVerifiedToday,
                approvedExitsCount,
                totalExitsCount
            },
            recentActivity: {
                exits: recentExits
            }
        });
    } catch (err) {
        logger.error('[Dashboard] Security stats error:', err);
        res.status(500).json({ error: 'Failed to load security dashboard stats' });
    }
};

module.exports = { getStats, getSecurityStats };
