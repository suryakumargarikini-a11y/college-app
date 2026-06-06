/**
 * SITAM Smart ERP — ERP Selector Registry
 *
 * Centralized registry of all CSS/attribute selectors used during ERP scraping.
 * Each key maps to a fallback chain ordered from most-specific to most-generic.
 *
 * MAINTENANCE: When ERP UI changes, add new selectors at the TOP of the array.
 * Old selectors are kept as fallbacks. Never remove selectors until confirmed broken
 * across multiple environments.
 *
 * Selector types used:
 *   - ID (#id)                  — most specific, most fragile on redesigns
 *   - Name attribute            — form inputs are usually stable
 *   - Data attribute            — semantic, usually stable
 *   - Class (.class)            — may change on UI framework upgrades
 *   - Structural (tag:has, :nth) — most resilient to style changes
 *   - Text-based (:contains)    — slowest but highest drift tolerance
 */

'use strict';

const ERP_SELECTORS = {
    // ─── Login Page ────────────────────────────────────────────────

    LOGIN_USERNAME: [
        '#txtId2',
        'input[name="txtId2"]',
        'input[id*="txtId"]',
        'input[placeholder*="User"]',
        'input[placeholder*="ID"]',
        'input[placeholder*="Roll"]',
        'form input[type=text]:first-of-type'
    ],

    LOGIN_PASSWORD: [
        '#txtPwd2',
        'input[name="txtPwd2"]',
        'input[id*="txtPwd"]',
        'input[type=password]',
        'form input[type=password]:first-of-type'
    ],

    LOGIN_BUTTON: [
        '#imgBtn2',
        'input[name="imgBtn2"]',
        'input[type=image]',
        'input[type=submit]',
        'button[type=submit]',
        '.login-btn',
        'form button:last-of-type'
    ],

    // Login success indicator — these appear only after successful login
    LOGGED_IN_INDICATOR: [
        '#lblUser',
        '#ctl00_lblUser',
        '[id*="lblUser"]',
        '.welcome-user',
        '[id*="StudentName"]',
        '.student-name',
        'span[id$="lblStudentName"]'
    ],

    // ─── CAPTCHA / Anti-Bot ────────────────────────────────────────────

    CAPTCHA_INDICATOR: [
        'img[src*="captcha"]',
        'img[src*="Captcha"]',
        'div.g-recaptcha',
        '#captchaDiv',
        '.captcha',
        'input[id*="captcha"]',
        'iframe[src*="recaptcha"]'
    ],

    CLOUDFLARE_INDICATOR: [
        '#cf-browser-verification',
        '.cf-browser-verification',
        '[data-translate="checking_browser"]',
        '#cf-challenge-form'
    ],

    // ─── Profile Page ──────────────────────────────────────────────

    PROFILE_CONTAINER: [
        '#divProfile',
        '[id*="divProfile"]',
        '[id*="ProfileDiv"]',
        '.profile-container',
        '[data-section="profile"]',
        'div:has(table:has(td:contains("Name")))'
    ],

    PROFILE_TRIGGER: [
        // JS functions to call if content is not auto-loaded
        // These are evaluated as page.evaluate expressions
    ],

    // ─── Marks / Results Page ──────────────────────────────────────

    MARKS_CONTAINER: [
        '#divMarks',
        '[id*="divMarks"]',
        '[id*="MarksDiv"]',
        '.marks-container',
        '[data-section="marks"]',
        'div:has(table:has(td:contains("Grade")))'
    ],

    // ─── Fees Page ──────────────────────────────────────────────────

    FEES_CONTAINER: [
        '#divReport',
        '[id*="divReport"]',
        '[id*="FeeDiv"]',
        '[id*="feesDiv"]',
        '.fees-container',
        '[data-section="fees"]',
        'div:has(table:has(td:contains("Grand Total")))'
    ],

    // ─── Assignments Page ───────────────────────────────────────────

    ASSIGNMENTS_CONTAINER: [
        '#divAssignments',
        '[id*="divAssignments"]',
        '[id*="AssignmentsDiv"]',
        '.assignments-container',
        '[data-section="assignments"]',
        'div:has(table:has(th:contains("Assignment")))'
    ],

    // ─── Navigation Links ──────────────────────────────────────────

    NAV_PROFILE: [
        'a[href*="StudentProfile"]',
        'a[href*="Profile"]',
        '#lnkProfile',
        'nav a:contains("Profile")',
        'a:contains("My Profile")'
    ],

    NAV_MARKS: [
        'a[href*="StudentMarksReport"]',
        'a[href*="Marks"]',
        'a[href*="Results"]',
        '#lnkMarks',
        'nav a:contains("Marks")',
        'nav a:contains("Results")'
    ],

    NAV_FEES: [
        'a[href*="studentpayments"]',
        'a[href*="FeePayment"]',
        'a[href*="Fees"]',
        '#lnkFees',
        'nav a:contains("Fees")',
        'nav a:contains("Payment")'
    ],

    NAV_ASSIGNMENTS: [
        'a[href*="StudentAssignmentsReport"]',
        'a[href*="Assignment"]',
        '#lnkAssignments',
        'nav a:contains("Assignment")'
    ],

    // ─── Session / State Indicators ────────────────────────────────────

    SESSION_EXPIRED_INDICATOR: [
        '#txtId2',               // login page username field
        'input[name="txtId2"]', // login page by name
        '.login-form',
        'form[action*="Default"]',
        'form[action*="login"]'
    ],

    LOGOUT_LINK: [
        'a[href*="Logout"]',
        'a[href*="logout"]',
        '#lnkLogout',
        '.logout-btn',
        'a:contains("Logout")',
        'a:contains("Sign Out")'
    ]
};

/**
 * URL templates for ERP pages
 */
const ERP_URLS = {
    LOGIN:       '/SATYA/Default.aspx',
    PROFILE:     '/SATYA/Academics/StudentProfile.aspx',
    MARKS:       '/SATYA/Academics/StudentMarksReport.aspx',
    FEES:        '/SATYA/FeePayments/studentpayments.aspx',
    ASSIGNMENTS: '/SATYA/Academics/StudentAssignmentsReport.aspx',
    LOGOUT:      '/SATYA/Logout.aspx'
};

/**
 * Content div IDs expected per page (used for waitForContent checks)
 */
const PAGE_CONTENT_IDS = {
    PROFILE:     ['divProfile', 'ctl00_ContentPlaceHolder1_divProfile'],
    MARKS:       ['divMarks',   'ctl00_ContentPlaceHolder1_divMarks'],
    FEES:        ['divReport',  'ctl00_ContentPlaceHolder1_divReport'],
    ASSIGNMENTS: ['divAssignments', 'ctl00_ContentPlaceHolder1_GridView1']
};

module.exports = { ERP_SELECTORS, ERP_URLS, PAGE_CONTENT_IDS };
