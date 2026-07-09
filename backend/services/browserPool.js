/**
 * SITAM Smart ERP — Browser Pool (Shim)
 *
 * This file is a thin shim. The full production implementation lives in:
 *   services/browserPool/ (dual-pool architecture)
 *
 * Architecture:
 *   AUTH_POOL  — ERP authentication only (fixed size, high priority)
 *   SYNC_POOL  — Background scraping (auto-scaling, priority queue)
 *
 * All require('./browserPool') and require('../services/browserPool') calls
 * continue to work unchanged — this shim forwards everything to the new module.
 *
 * @see services/browserPool/index.js
 */

// Re-export the new dual-pool implementation
module.exports = require('./browserPool/index');
