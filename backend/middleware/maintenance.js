'use strict';
const prisma = require('../services/dbService');

const maintenanceMiddleware = async (req, res, next) => {
    try {
        // Explicitly bypass for admin APIs and security portal endpoints
        if (req.originalUrl && req.originalUrl.startsWith('/api/admin')) {
            return next();
        }

        // Query the system setting
        const settings = await prisma.systemSetting.findUnique({
            where: { id: 'system' }
        });

        if (settings && settings.maintenanceMode) {
            return res.status(503).json({
                maintenanceMode: true,
                message: settings.maintenanceMessage
            });
        }
        
        next();
    } catch (err) {
        // Fallback: do not block application access if settings table query fails
        next();
    }
};

module.exports = maintenanceMiddleware;
