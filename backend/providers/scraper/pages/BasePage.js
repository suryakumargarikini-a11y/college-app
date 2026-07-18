'use strict';

/**
 * SITAM Smart ERP — BasePage
 *
 * Shared base class for all ERP page objects.
 * Provides the PAGE_STATE state machine and event emission.
 *
 * STATE MACHINE:
 *   INIT → LOADING → READY → SCRAPING → SUCCESS
 *                      ↓                   ↓
 *                    FAILED ←←←←←←←←←← FAILED
 *
 * PAGE OBJECT CONTRACT (enforced by this base class):
 *   - Accepts (page, requestId) in constructor — NOTHING ELSE
 *   - Owns: navigation, extraction, selectors
 *   - NEVER imports DebugCapture, logger, DB, or any infrastructure service
 *   - Throws plain Error on failure — ErpBrowserService catches and calls DebugCapture
 *   - Emits 'stateChange' events — ErpBrowserService subscribes and logs them
 *
 * USAGE:
 *   class LoginPage extends BasePage {
 *       async extract() {
 *           this._setState(PAGE_STATE.LOADING);
 *           await this._page.goto(url);
 *           this._setState(PAGE_STATE.READY);
 *           this._setState(PAGE_STATE.SCRAPING);
 *           const data = await this._page.evaluate(...);
 *           this._setState(PAGE_STATE.SUCCESS);
 *           return data;
 *       }
 *   }
 *
 *   // In ErpBrowserService:
 *   const po = new LoginPage(page, requestId);
 *   po.on('stateChange', ({ from, to }) =>
 *       logger.info(`[${requestId}] LoginPage: ${from} → ${to}`)
 *   );
 *   const data = await po.extract();  // throws on failure → ErpBrowserService catches
 *
 * @module BasePage
 */

const { EventEmitter } = require('events');

/**
 * Page state enum.
 * @enum {string}
 */
const PAGE_STATE = {
    INIT:     'INIT',
    LOADING:  'LOADING',
    READY:    'READY',
    SCRAPING: 'SCRAPING',
    SUCCESS:  'SUCCESS',
    FAILED:   'FAILED',
};

class BasePage extends EventEmitter {
    /**
     * @param {import('../../services/browserPool/providers/adapters/IPageAdapter')} page
     * @param {string} requestId  - REQ-XXXXX correlation ID
     */
    constructor(page, requestId) {
        super();
        this._page      = page;
        this._requestId = requestId;
        this.state      = PAGE_STATE.INIT;
    }

    /**
     * Transition to a new state and emit a 'stateChange' event.
     * ErpBrowserService subscribes to this for structured logging.
     *
     * @param {string} newState  - one of PAGE_STATE values
     */
    _setState(newState) {
        const from = this.state;
        this.state = newState;
        this.emit('stateChange', {
            page:      this.constructor.name,
            requestId: this._requestId,
            from,
            to:        newState,
            timestamp: Date.now(),
        });
    }

    /**
     * Every concrete page object must implement this.
     * Called by ErpBrowserService.
     * Must set state through LOADING → READY → SCRAPING → SUCCESS (or FAILED on throw).
     *
     * @returns {Promise<*>}
     * @abstract
     */
    async extract() {
        throw new Error(`[${this.constructor.name}] extract() not implemented`);
    }
}

module.exports = { BasePage, PAGE_STATE };
