'use strict';
const prisma = require('../../services/dbService');
const logger = require('../../services/logger');
const { auditLogRepository } = require('../../repositories/index');

const getSettings = async (req, res) => {
    try {
        const settings = await prisma.systemSetting.findUnique({
            where: { id: 'system' }
        });
        res.json(settings);
    } catch (err) {
        logger.error('[Settings] Fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
};

const updateSettings = async (req, res) => {
    try {
        const { maintenanceMode, maintenanceMessage } = req.body;
        
        const prev = await prisma.systemSetting.findUnique({ where: { id: 'system' } });
        
        const settings = await prisma.systemSetting.upsert({
            where: { id: 'system' },
            update: {
                ...(maintenanceMode !== undefined && { maintenanceMode }),
                ...(maintenanceMessage !== undefined && { maintenanceMessage })
            },
            create: {
                id: 'system',
                maintenanceMode: maintenanceMode || false,
                maintenanceMessage: maintenanceMessage || 'SITAM Smart ERP is currently undergoing scheduled maintenance. Please try again later.'
            }
        });

        // Audit log the changes
        if (prev && prev.maintenanceMode !== settings.maintenanceMode) {
            await auditLogRepository.log(
                null,
                'MAINTENANCE_TOGGLE', 
                `System Maintenance Mode toggled to ${settings.maintenanceMode ? 'ON' : 'OFF'} by admin ${req.admin.email}`,
                req.admin.id,
                'SECURITY'
            );
        }

        res.json(settings);
    } catch (err) {
        logger.error('[Settings] Update error:', err);
        res.status(500).json({ error: 'Failed to update settings' });
    }
};

module.exports = { getSettings, updateSettings };
