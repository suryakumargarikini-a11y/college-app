'use strict';

const logger = require('../services/logger');
const demoProvider = require('./demoProvider');
const productionProvider = require('./productionProvider');

const isDemo = process.env.DEMO_MODE === 'true';

logger.info(`[DataProvider] Decoupling adapter loaded. Mode: ${isDemo ? 'DEMO' : 'PRODUCTION'}`);

const activeProvider = isDemo ? demoProvider : productionProvider;

module.exports = activeProvider;
