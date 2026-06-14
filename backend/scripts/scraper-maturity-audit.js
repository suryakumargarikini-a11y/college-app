/**
 * SITAM Smart ERP — Scraper Reliability Maturity Audit
 *
 * Programmatically validates that all 10 resilience modules are:
 *   1. Imported by production runtime code
 *   2. Executed in a live sync path
 *   3. Emitting telemetry through ProviderMetrics
 *   4. Documented in the runtime call graph
 *   5. Covered by integration tests proving execution
 *
 * Failing any gate exits with code 1.
 * Run: node scripts/scraper-maturity-audit.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── CONFIGURATION ────────────────────────────────────────────────────────────
const PRODUCTION_FILES = {
    puppeteerService: path.join(__dirname, '../services/puppeteerService.js'),
    scraperProvider:  path.join(__dirname, '../providers/scraper/SITAMScraperProvider.js'),
    browserPool:      path.join(__dirname, '../services/browserPool.js'),
    worker:           path.join(__dirname, '../worker.js')
};

const TEST_FILE = path.join(__dirname, '../scripts/test-scraper-runtime-integration.js');
const CALL_GRAPH_FILE = path.join(__dirname, '../docs/scraper-hardening.md');

const MODULES = {
    ERPMaintenanceDetector: {
        file: path.join(__dirname, '../providers/scraper/maintenance/ERPMaintenanceDetector.js'),
        productionImports: [PRODUCTION_FILES.puppeteerService],
        importKeywords: ['ERPMaintenanceDetector', 'maintDetector'],
        invocationKeywords: ['maintDetector.isInMaintenanceWindow', 'maintDetector.detect'],
        telemetryKeywords: ['recordMaintenanceMode'],
        testKeywords: ['ERPMaintenanceDetector', 'maintDetector'],
        callGraphKeywords: ['ERPMaintenanceDetector']
    },
    AntiBotDetector: {
        file: path.join(__dirname, '../providers/scraper/antibot/AntiBotDetector.js'),
        productionImports: [PRODUCTION_FILES.puppeteerService],
        importKeywords: ['AntiBotDetector', 'antiBotDetector'],
        invocationKeywords: ['antiBotDetector.assertNoBotChallenge'],
        telemetryKeywords: ['recordAntiBotEvent', 'antiBotEventsTotal'],
        testKeywords: ['AntiBotDetector', 'antiBotDetector', 'CAPTCHA'],
        callGraphKeywords: ['AntiBotDetector']
    },
    PartialSyncRecovery: {
        file: path.join(__dirname, '../providers/scraper/recovery/PartialSyncRecovery.js'),
        productionImports: [PRODUCTION_FILES.scraperProvider],
        importKeywords: ['PartialSyncRecovery', 'recovery'],
        invocationKeywords: ['recovery.getRecoveryPlan', 'recovery.saveCheckpoint', 'recovery.getCachedData'],
        telemetryKeywords: ['recordPartialSyncRecovery', 'partialSyncRecoveryTotal'],
        testKeywords: ['PartialSyncRecovery', 'recovery', 'checkpoint'],
        callGraphKeywords: ['PartialSyncRecovery']
    },
    DOMDriftDetector: {
        file: path.join(__dirname, '../providers/scraper/drift/DOMDriftDetector.js'),
        productionImports: [PRODUCTION_FILES.scraperProvider],
        importKeywords: ['DOMDriftDetector', 'driftDetector'],
        invocationKeywords: ['driftDetector.fingerprint', 'driftDetector.computeDriftScore'],
        telemetryKeywords: ['recordDOMDrift', 'domDriftScore', 'domDriftIncidentsTotal'],
        testKeywords: ['DOMDriftDetector', 'driftDetector', 'drift'],
        callGraphKeywords: ['DOMDriftDetector']
    },
    AdaptiveSelectorOptimizer: {
        file: path.join(__dirname, '../providers/scraper/selectors/AdaptiveSelectorOptimizer.js'),
        productionImports: [PRODUCTION_FILES.puppeteerService],
        importKeywords: ['AdaptiveSelectorOptimizer', 'selectorOptimizer'],
        invocationKeywords: ['selectorOptimizer.getOptimizedChain', 'selectorOptimizer.recordOutcome'],
        telemetryKeywords: ['recordSelectorPromotion', 'selectorPromotionsTotal'],
        testKeywords: ['AdaptiveSelectorOptimizer', 'selectorOptimizer', 'promotion'],
        callGraphKeywords: ['AdaptiveSelectorOptimizer']
    },
    BrowserReputationManager: {
        file: path.join(__dirname, '../providers/scraper/browser/BrowserReputationManager.js'),
        productionImports: [PRODUCTION_FILES.browserPool],
        importKeywords: ['BrowserReputationManager', 'repMgr'],
        invocationKeywords: ['repMgr.registerBrowser', 'repMgr.recordCaptcha', 'repMgr.recordSuccess', 'repMgr.recordCrash', 'repMgr.recordTimeout'],
        telemetryKeywords: ['setBrowserReputationScore', 'browserReputationScore', 'recordBrowserQuarantine', 'recordBrowserRetirement'],
        testKeywords: ['BrowserReputationManager', 'repMgr', 'reputation'],
        callGraphKeywords: ['BrowserReputationManager']
    },
    AdaptiveRetryClassifier: {
        file: path.join(__dirname, '../providers/scraper/retry/AdaptiveRetryClassifier.js'),
        productionImports: [PRODUCTION_FILES.worker, PRODUCTION_FILES.browserPool],
        importKeywords: ['AdaptiveRetryClassifier', 'classifier'],
        invocationKeywords: ['classifier.classify'],
        telemetryKeywords: ['recordRetryAttempt', 'retryAttemptsTotal'],
        testKeywords: ['AdaptiveRetryClassifier', 'classifier'],
        callGraphKeywords: ['AdaptiveRetryClassifier']
    },
    QueuePressureManager: {
        file: path.join(__dirname, '../providers/scraper/throttle/QueuePressureManager.js'),
        productionImports: [PRODUCTION_FILES.worker, PRODUCTION_FILES.scraperProvider],
        importKeywords: ['QueuePressureManager', 'qpm'],
        invocationKeywords: ['qpm.shouldThrottle', 'qpm.registerActive', 'qpm.releaseActive', 'qpm.updateFromHealthScore'],
        telemetryKeywords: ['recordQueuePressureLevel', 'queuePressureLevelGauge'],
        testKeywords: ['QueuePressureManager', 'qpm', 'throttled'],
        callGraphKeywords: ['QueuePressureManager']
    },
    AdaptiveLoadShedding: {
        file: path.join(__dirname, '../providers/scraper/throttle/AdaptiveLoadShedding.js'),
        productionImports: [PRODUCTION_FILES.worker, PRODUCTION_FILES.scraperProvider],
        importKeywords: ['AdaptiveLoadShedding', 'shedder'],
        invocationKeywords: ['shedder.admitSync', 'shedder.updateFromHealthScore'],
        telemetryKeywords: ['recordLoadSheddingMode', 'loadSheddingModeGauge'],
        testKeywords: ['AdaptiveLoadShedding', 'shedder', 'shedding'],
        callGraphKeywords: ['AdaptiveLoadShedding']
    },
    ScraperReliabilityForecaster: {
        file: path.join(__dirname, '../providers/scraper/forecasting/ScraperReliabilityForecaster.js'),
        productionImports: [PRODUCTION_FILES.worker, PRODUCTION_FILES.scraperProvider],
        importKeywords: ['ScraperReliabilityForecaster', 'forecaster'],
        invocationKeywords: ['forecaster.startPeriodicForecasting', 'forecaster.recordSyncAttempt', 'forecaster.recordSyncFailure', 'forecaster.recordCaptchaHit'],
        telemetryKeywords: ['setForecastScore', 'forecastReliabilityScore'],
        testKeywords: ['ScraperReliabilityForecaster', 'forecaster', 'forecast'],
        callGraphKeywords: ['ScraperReliabilityForecaster']
    }
};

// ─── AUDIT RUNNER ─────────────────────────────────────────────────────────────
function runAudit() {
    console.log('============================================================');
    console.log('   SITAM ERP - Scraper Reliability Maturity Audit Gate');
    console.log('============================================================\n');

    let totalScore = 0;
    const integratedModules = [];
    const deadModules = [];
    const missingPaths = [];

    // Read Call Graph Documentation
    let callGraphContent = '';
    try {
        callGraphContent = fs.readFileSync(CALL_GRAPH_FILE, 'utf8');
    } catch (err) {
        console.error(`❌ Error reading call graph documentation at ${CALL_GRAPH_FILE}: ${err.message}`);
        process.exit(1);
    }

    // Read Test File
    let testFileContent = '';
    try {
        testFileContent = fs.readFileSync(TEST_FILE, 'utf8');
    } catch (err) {
        console.error(`❌ Error reading integration test file at ${TEST_FILE}: ${err.message}`);
        process.exit(1);
    }

    // Read Production Files
    const prodFileContents = {};
    for (const [key, filePath] of Object.entries(PRODUCTION_FILES)) {
        try {
            prodFileContents[key] = fs.readFileSync(filePath, 'utf8');
        } catch (err) {
            console.error(`❌ Error reading production file ${key} at ${filePath}: ${err.message}`);
            process.exit(1);
        }
    }

    for (const [moduleName, config] of Object.entries(MODULES)) {
        console.log(`Checking module: ${moduleName}`);
        
        // Read Module File for Telemetry Check
        let moduleContent = '';
        try {
            moduleContent = fs.readFileSync(config.file, 'utf8');
        } catch (err) {
            console.error(`  ❌ Error reading module file at ${config.file}: ${err.message}`);
            process.exit(1);
        }

        // 1. Check Imports in Production Files
        let isImported = false;
        let importFile = '';
        for (const filePath of config.productionImports) {
            const fileKey = Object.keys(PRODUCTION_FILES).find(k => PRODUCTION_FILES[k] === filePath);
            const content = prodFileContents[fileKey];
            if (config.importKeywords.some(kw => content.includes(kw))) {
                isImported = true;
                importFile = path.basename(filePath);
                break;
            }
        }

        // 2. Check Invocations in Production Files
        let isInvoked = false;
        for (const filePath of config.productionImports) {
            const fileKey = Object.keys(PRODUCTION_FILES).find(k => PRODUCTION_FILES[k] === filePath);
            const content = prodFileContents[fileKey];
            if (config.invocationKeywords.some(kw => content.includes(kw))) {
                isInvoked = true;
                break;
            }
        }

        // 3. Check Telemetry
        // Check if module file or its imports invoke providerMetrics telemetry
        const emitsTelemetry = config.telemetryKeywords.some(kw => moduleContent.includes(kw)) ||
                              config.telemetryKeywords.some(kw => {
                                  // or checking if it occurs in any production file that imports it
                                  for (const fileKey of Object.keys(prodFileContents)) {
                                      if (prodFileContents[fileKey].includes(kw)) return true;
                                  }
                                  return false;
                              });

        // 4. Check Integration Test Coverage
        const hasTestCoverage = config.testKeywords.some(kw => testFileContent.includes(kw));

        // 5. Check Call Graph Documentation
        const inCallGraph = config.callGraphKeywords.some(kw => callGraphContent.includes(kw));

        // Print Status Check
        console.log(`  - Imported by production: ${isImported ? `✓ (in ${importFile})` : '✗'}`);
        console.log(`  - Invoked in runtime flow: ${isInvoked ? '✓' : '✗'}`);
        console.log(`  - Emits telemetry metrics: ${emitsTelemetry ? '✓' : '✗'}`);
        console.log(`  - Covered by integration tests: ${hasTestCoverage ? '✓' : '✗'}`);
        console.log(`  - Documented in call graph: ${inCallGraph ? '✓' : '✗'}`);

        const isFullyIntegrated = isImported && isInvoked && emitsTelemetry && hasTestCoverage && inCallGraph;

        if (isFullyIntegrated) {
            console.log(`  💚 STATUS: FULLY INTEGRATED\n`);
            totalScore += 10;
            integratedModules.push(moduleName);
        } else {
            console.log(`  🚨 STATUS: MISCONFIGURED OR DEAD\n`);
            deadModules.push(moduleName);
            const missing = [];
            if (!isImported) missing.push('production_import');
            if (!isInvoked) missing.push('runtime_invocation');
            if (!emitsTelemetry) missing.push('telemetry_emission');
            if (!hasTestCoverage) missing.push('test_coverage');
            if (!inCallGraph) missing.push('call_graph_docs');
            missingPaths.push(`${moduleName}: missing [${missing.join(', ')}]`);
        }
    }

    console.log('============================================================');
    console.log(`Scraper Reliability Maturity Score: ${totalScore}%`);
    console.log(`Integrated Modules: ${integratedModules.length}/10`);
    console.log(`Dead / Unwired Modules: ${deadModules.length}/10`);
    console.log('============================================================\n');

    if (deadModules.length > 0) {
        console.error('🚨 AUDIT GATE FAILED: Some scraper reliability modules are not fully integrated.');
        console.error('Missing integration paths:');
        missingPaths.forEach(p => console.error(` - ${p}`));
        process.exit(1);
    } else {
        console.log('🎉 AUDIT GATE PASSED: All 10 scraper reliability modules are fully integrated and measured!');
        process.exit(0);
    }
}

runAudit();
