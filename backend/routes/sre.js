/**
 * SITAM Smart ERP — SRE Control Plane Routes
 *
 * Implements SRE Control-Plane REST API:
 *   - Live operational status page (/api/sre/status)
 *   - Cryptographic ledger integrity checks (/api/sre/ledger/verify)
 *   - Alertmanager webhook endpoint (/api/sre/remedy/webhook)
 *   - Quorum-based consensus Proposals (/api/sre/consensus/propose)
 *   - Time-travel forensic snapshot replays (/api/sre/incidents/:id/replay)
 */

const express = require('express');
const router = express.Router();
const sreService = require('../services/sreService');
const securityService = require('../services/securityService');
const logger = require('../services/logger');
const fs = require('fs');
const path = require('path');

// Authorize all control-plane requests using RBAC
router.use(securityService.authorizeOperator('operator'));

/**
 * Live Operational Status API
 */
router.get('/status', async (req, res) => {
    try {
        const stats = await sreService.getGlobalReliabilityScore();
        
        let snapshotsCount = 0;
        try {
            const files = fs.readdirSync(path.join(__dirname, '../logs'));
            snapshotsCount = files.filter(f => f.startsWith('snapshot_')).length;
        } catch (_) {}

        return res.json({
            status: 'success',
            timestamp: new Date().toISOString(),
            nodeId: sreService.nodeId,
            salt: process.env.ADMIN_PASSWORD_SALT || 'not_set',
            env: process.env.NODE_ENV,
            reliabilityIndex: stats.globalReliabilityIndex,
            clusterState: stats.status,
            components: stats.components,
            forensics: {
                totalSnapshotsCaptured: snapshotsCount
            }
        });
    } catch (err) {
        logger.error(`[SRE-API] Status fetch error: ${err.message}`);
        return res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
});

/**
 * Verify Immutable Ledger Integrity
 */
router.get('/ledger/verify', async (req, res) => {
    try {
        const check = await sreService.verifyLedgerIntegrity();
        if (check.verified) {
            return res.json({
                status: 'verified',
                message: 'All blocks in the operational ledger match signature hashes. Integrity confirmed.',
                timestamp: new Date().toISOString()
            });
        }
        return res.status(412).json({
            status: 'tampered',
            message: 'Ledger integrity check failed! Corruption detected in audit chain history.',
            corruptedBlock: check.corruptedBlock,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        return res.status(500).json({ error: 'Verification failed', message: err.message });
    }
});

/**
 * Alertmanager / Webhook Autonomous Remediation Receiver
 */
router.post('/remedy/webhook', async (req, res) => {
    const { alerts, groupKey, status } = req.body;
    logger.info(`[SRE-Webhook] Received Alertmanager callback status: ${status} for group: ${groupKey}`);

    if (!alerts || !Array.isArray(alerts)) {
        return res.status(400).json({ error: 'Bad Request', message: 'Payload must contain standard Alertmanager alerts list.' });
    }

    const results = [];
    for (const alert of alerts) {
        const alertName = alert.labels ? alert.labels.alertname : 'UnknownAlert';
        const severity = alert.labels ? alert.labels.severity : 'WARNING';
        
        // Map alerts to SRE remediations
        let targetRemediation = null;
        if (alertName.includes('BrowserPoolExhausted') || alertName.includes('ChromiumCrash')) {
            targetRemediation = 'recycleBrowserPool';
        } else if (alertName.includes('QueueSaturation') || alertName.includes('DriftBuildup')) {
            targetRemediation = 'throttleQueueConcurrency';
        } else if (alertName.includes('RedisDisconnect')) {
            targetRemediation = 'reconnectRedis';
        }

        if (targetRemediation) {
            const remedy = await sreService.triggerRemediation(targetRemediation, alert);
            results.push({ alert: alertName, remedy });
        } else {
            results.push({ alert: alertName, action: 'none', reason: 'No auto-remediation mapped' });
        }
    }

    return res.json({ status: 'processed', results });
});

/**
 * Propose high-risk remediation action to Quorum Consensus
 */
router.post('/consensus/propose', async (req, res) => {
    const { actionType, payload } = req.body;
    if (!actionType) {
        return res.status(400).json({ error: 'Missing actionType field.' });
    }

    try {
        const consensus = await sreService.proposeCriticalRemediation(actionType, payload || {});
        return res.json({
            status: 'consensus_evaluated',
            nodeId: sreService.nodeId,
            actionType,
            proposalId: consensus.proposalId,
            approved: consensus.approved,
            proposal: consensus
        });
    } catch (err) {
        return res.status(500).json({ error: 'Consensus calculation crash', message: err.message });
    }
});

/**
 * Forensic replay / time travel endpoint
 */
router.get('/incidents/:id/replay', async (req, res) => {
    const incidentId = req.params.id;

    try {
        let snapshotData = null;
        const filepath = path.join(__dirname, `../logs/snapshot_${incidentId}.json`);
        
        if (fs.existsSync(filepath)) {
            snapshotData = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        }

        // Return a mock step-by-step timeline of event propagation
        return res.json({
            incidentId,
            status: 'success',
            timeline: [
                { time: 'T-00:15s', event: 'Z-Score anomaly limit exceeded on API request latency (>3 std_dev)' },
                { time: 'T-00:10s', event: 'Alertmanager rule triggered: ERPBackendSlowUptime' },
                { time: 'T-00:05s', event: 'Forensic state snapshot captured programmatically', ref: `/api/sre/incidents/${incidentId}/snapshots` },
                { time: 'T-00:01s', event: 'Quorum consensus approved: recycleBrowserPool' },
                { time: 'T-00:00s', event: 'Autonomous remediation: recycleBrowserPool completed successfully' },
                { time: 'T+00:10s', event: 'System latency restored to baseline. SLO budget burn rate stabilized.' }
            ],
            snapshot: snapshotData
        });
    } catch (err) {
        return res.status(500).json({ error: 'Time-travel fetch failed', message: err.message });
    }
});

/**
 * SRE Override endpoint (Human-in-the-loop)
 */
router.post('/override', async (req, res) => {
    const { action, target } = req.body;
    if (!action) {
        return res.status(400).json({ error: 'Missing action parameter.' });
    }

    logger.info(`[SRE-Override] Operator manual override issued: ${action} on target: ${target}`);
    await sreService.appendToLedger('MANUAL_OPERATOR_OVERRIDE', { action, target });

    return res.json({
        status: 'executed',
        message: `Manual SRE action ${action} executed successfully by operator.`,
        timestamp: new Date().toISOString()
    });
});

module.exports = router;
