'use strict';

/**
 * PriorityQueue — Min-Heap Implementation for Browser Job Scheduling
 *
 * Rules:
 *   - Lower priority NUMBER = higher urgency (Login=1 always beats Background=6)
 *   - Equal priority → FIFO by enqueue timestamp
 *   - O(log n) enqueue and dequeue
 *   - O(n) targeted remove (for timeout cancellation)
 *
 * @module PriorityQueue
 */

/**
 * @typedef {Object} QueueEntry
 * @property {number}           priority    - Urgency level (lower = more urgent)
 * @property {number}           enqueuedAt  - Unix ms timestamp of enqueue
 * @property {Function}         resolve     - Promise resolve callback
 * @property {Function}         reject      - Promise reject callback
 * @property {NodeJS.Timeout|null} timer    - Timeout handle (cleared on dequeue)
 * @property {string}           requestId   - Correlation ID for logging
 * @property {string}           jobType     - Human-readable job type key
 * @property {string|undefined} userId      - Student ID (for session affinity)
 */

class PriorityQueue {
    constructor() {
        /** @type {QueueEntry[]} */
        this._heap = [];
    }

    /** @returns {number} Number of entries currently queued */
    get length() { return this._heap.length; }

    /** @returns {boolean} True when queue has no entries */
    get isEmpty() { return this._heap.length === 0; }

    /**
     * Insert an entry into the queue. O(log n).
     * @param {QueueEntry} entry
     */
    enqueue(entry) {
        this._heap.push(entry);
        this._bubbleUp(this._heap.length - 1);
    }

    /**
     * Remove and return the highest-priority entry. O(log n).
     * @returns {QueueEntry|undefined}
     */
    dequeue() {
        if (this._heap.length === 0) return undefined;
        const top = this._heap[0];
        const last = this._heap.pop();
        if (this._heap.length > 0) {
            this._heap[0] = last;
            this._sinkDown(0);
        }
        return top;
    }

    /**
     * Peek at the root without removing it. O(1).
     * @returns {QueueEntry|undefined}
     */
    peek() { return this._heap[0]; }

    /**
     * Remove a specific entry by its reject function reference.
     * Used by timeout handlers to remove an entry that expired.
     * O(n) scan + O(log n) rebalance.
     * @param {Function} rejectFn
     */
    remove(rejectFn) {
        const idx = this._heap.findIndex(e => e.reject === rejectFn);
        if (idx < 0) return;
        if (idx === this._heap.length - 1) {
            this._heap.pop();
            return;
        }
        this._heap[idx] = this._heap.pop();
        // Rebalance both directions — the replacement could go either way
        this._bubbleUp(idx);
        this._sinkDown(idx);
    }

    /**
     * Reject and drain every entry. Used on pool shutdown.
     * @param {string} reason - Error message for all waiting callers
     */
    cancelAll(reason) {
        for (const entry of this._heap) {
            if (entry.timer) clearTimeout(entry.timer);
            try { entry.reject(new Error(reason)); } catch (_) {}
        }
        this._heap = [];
    }

    // ─── Heap internals ───────────────────────────────────────────────────────

    _bubbleUp(i) {
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this._compare(i, parent) < 0) {
                this._swap(i, parent);
                i = parent;
            } else {
                break;
            }
        }
    }

    _sinkDown(i) {
        const n = this._heap.length;
        while (true) {
            let smallest = i;
            const l = 2 * i + 1;
            const r = 2 * i + 2;
            if (l < n && this._compare(l, smallest) < 0) smallest = l;
            if (r < n && this._compare(r, smallest) < 0) smallest = r;
            if (smallest === i) break;
            this._swap(i, smallest);
            i = smallest;
        }
    }

    /** @returns {number} negative if a < b, 0 if equal, positive if a > b */
    _compare(a, b) {
        const ea = this._heap[a];
        const eb = this._heap[b];
        // Primary sort: priority (lower number = higher urgency)
        if (ea.priority !== eb.priority) return ea.priority - eb.priority;
        // Secondary sort: enqueue time (earlier = higher urgency — FIFO within tier)
        return ea.enqueuedAt - eb.enqueuedAt;
    }

    _swap(a, b) {
        [this._heap[a], this._heap[b]] = [this._heap[b], this._heap[a]];
    }
}

/**
 * Job priority level constants.
 *
 * Lower number = higher urgency.
 * FEES and ATTENDANCE share priority 3 — both needed for the dashboard.
 * MARKS, ASSIGNMENTS, TIMETABLE, NOTIFICATIONS share priority 4/5 —
 *   they load in the background after the dashboard is shown.
 */
const JOB_PRIORITY = Object.freeze({
    LOGIN:           1,   // ERP authentication — must NEVER be starved
    MANUAL_REFRESH:  2,   // User-triggered force-sync
    ATTENDANCE:      3,   // Critical dashboard data (returned synchronously with JWT)
    FEES:            3,   // Critical dashboard data (returned synchronously with JWT)
    MARKS:           4,   // Background — loads after dashboard
    ASSIGNMENTS:     5,   // Background
    TIMETABLE:       5,   // Background
    NOTIFICATIONS:   5,   // Background
    BACKGROUND_SYNC: 6,   // Scheduled/automated background refresh
});

module.exports = { PriorityQueue, JOB_PRIORITY };
