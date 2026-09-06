/**
 * PrivacyPolicy.jsx
 *
 * PUBLIC route — /privacy-policy
 * ─────────────────────────────────────────────────────────────────────────────
 * This page is intentionally placed OUTSIDE AdminLayout and ALL authentication
 * guards. It must be accessible:
 *   • without an admin account
 *   • without a student account
 *   • without a session or cookie
 *   • in incognito / private browser mode
 *   • by direct URL navigation and after a page refresh
 *
 * It is the official Privacy Policy URL submitted to Google Play Console for
 * the My SITAM Android application (package: co.in.sitamecap.erp).
 *
 * ─── PLACEHOLDERS — MUST BE REPLACED BEFORE GOING LIVE ──────────────────────
 * Three constants below are intentional placeholders.
 * They must be filled with official, verified information before this page
 * is submitted to Google Play Console or any public index.
 *
 *   PRIVACY_CONTACT_EMAIL  — Official institutional privacy / support email
 *   SUPPORT_URL            — Official institutional support or contact URL
 *   EFFECTIVE_DATE         — The effective / last-updated date of this policy
 *
 * Do NOT invent these values. Obtain them from the institution's official
 * communications team or legal/compliance team.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React from 'react';
import { Link } from 'react-router-dom';

/* ─── Official Placeholders ────────────────────────────────────────────────── */
/* IMPORTANT: Replace the three values below with confirmed official information
   before this page is deployed to production and submitted to Google Play.    */
const PRIVACY_CONTACT_EMAIL = '[OFFICIAL PRIVACY/SUPPORT EMAIL]';
const SUPPORT_URL = '[OFFICIAL SUPPORT URL]';
const EFFECTIVE_DATE = '[INSERT EFFECTIVE DATE]';

/* ─── Application / Institution Constants ───────────────────────────────────── */
const APP_NAME = 'My SITAM';
const INSTITUTION = 'SITAM';
const ANDROID_PACKAGE = 'co.in.sitamecap.erp';

/* ─── Sub-components ─────────────────────────────────────────────────────────── */

function Section({ id, title, children }) {
  return (
    <section id={id} className="pp-section">
      <h2 className="pp-section-title">{title}</h2>
      <div className="pp-section-body">{children}</div>
    </section>
  );
}

function BulletList({ items }) {
  return (
    <ul className="pp-list">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/* ─── Main Component ─────────────────────────────────────────────────────────── */

export default function PrivacyPolicy() {
  return (
    <>
      {/* ── Page-level SEO meta (injected into <head> via React 18 / document title) ── */}
      {/* Note: proper <meta> tags are best handled via react-helmet or Vite's
          index.html. We set document.title here as a lightweight fallback.         */}
      <TitleSetter />

      {/* ── Scoped styles for this standalone public page ─────────────────────── */}
      <style>{PRIVACY_POLICY_CSS}</style>

      <div className="pp-root">
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <header className="pp-header" role="banner">
          <div className="pp-header-inner">
            <div className="pp-header-brand">
              {/* Logo — served from Vite public dir, same as Login.jsx */}
              <img
                src="/sitam-logo.png"
                alt={`${INSTITUTION} Official Logo`}
                className="pp-logo"
                width="52"
                height="52"
              />
              <div className="pp-header-text">
                <span className="pp-header-app">{APP_NAME}</span>
                <span className="pp-header-subtitle">by {INSTITUTION}</span>
              </div>
            </div>
            <div className="pp-header-badge">
              <span className="pp-badge-icon" aria-hidden="true">🔒</span>
              <span>Privacy Policy</span>
            </div>
          </div>
        </header>

        {/* ── Hero / Page Title ──────────────────────────────────────────────── */}
        <div className="pp-hero">
          <div className="pp-container">
            <h1 className="pp-hero-title">Privacy Policy</h1>
            <p className="pp-hero-subtitle">
              {APP_NAME} &mdash; Student ERP Application &bull; {INSTITUTION}
            </p>
            <p className="pp-hero-meta">
              <strong>Android Package:</strong> {ANDROID_PACKAGE}
            </p>
            <p className="pp-hero-effective">
              <strong>Effective Date:</strong> {EFFECTIVE_DATE}
            </p>
          </div>
        </div>

        {/* ── Table of Contents (quick links) ───────────────────────────────── */}
        <div className="pp-container">
          <nav className="pp-toc" aria-label="Policy sections">
            <p className="pp-toc-label">Contents</p>
            <ol className="pp-toc-list">
              {TOC_ITEMS.map(({ id, label }) => (
                <li key={id}>
                  <a href={`#${id}`} className="pp-toc-link">
                    {label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </div>

        {/* ── Policy Body ───────────────────────────────────────────────────── */}
        <main className="pp-container pp-main" id="main-content" role="main">

          {/* 1. Introduction */}
          <Section id="introduction" title="1. Introduction">
            <p>
              {APP_NAME} is a student-focused digital application developed for
              authorized students and institutional users of {INSTITUTION}
              (hereinafter &ldquo;the Institution&rdquo;). The application provides
              students with access to their personal academic information, schedules,
              results, fees, library resources, and institutional communications
              through a secure digital interface.
            </p>
            <p>
              This Privacy Policy describes how {APP_NAME} and {INSTITUTION}
              (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;) may
              collect, access, use, store, protect, retain, and delete information
              in connection with your use of the {APP_NAME} application and
              associated services.
            </p>
            <p>
              By accessing or using {APP_NAME}, you acknowledge that you have read
              and understood this Privacy Policy. If you do not agree with this
              policy, please discontinue use of the application.
            </p>
          </Section>

          {/* 2. Information We May Process */}
          <Section id="information" title="2. Information We May Process">
            <p>
              {APP_NAME} is connected to the {INSTITUTION} ERP system. When you
              sign in, the application accesses and displays information that is
              already held by the Institution in its academic and administrative
              records. The categories of information that may be accessed or
              processed include the following:
            </p>

            <h3 className="pp-subheading">Identity &amp; Profile Information</h3>
            <BulletList items={[
              'Student name',
              'Student ID / registration number / roll number',
              'Date of birth',
              'Gender',
              'Photograph / profile image',
              'Contact email address',
              'Contact phone number',
              'Residential and correspondence address',
              'Parent / guardian names and contact information',
            ]} />

            <h3 className="pp-subheading">Academic Information</h3>
            <BulletList items={[
              'Academic programme and branch',
              'Current semester and section',
              'Academic year and admission details',
              'Attendance records',
              'Marks, examination results, and grade information',
              'Timetable and schedule information',
              'Assignment and coursework information',
              'Syllabus information',
              'CGPA and academic history',
            ]} />

            <h3 className="pp-subheading">Financial Information</h3>
            <BulletList items={[
              'Fee ledger and payment status information',
              'Fee notice information',
            ]} />

            <h3 className="pp-subheading">Library Information</h3>
            <BulletList items={[
              'Library usage and borrowing records',
            ]} />

            <h3 className="pp-subheading">Application &amp; Communication Information</h3>
            <BulletList items={[
              'Institutional announcements and notifications',
              'Achievement and placement information',
              'Authentication credentials (username and password — stored in hashed form)',
              'Session tokens required to maintain a signed-in session',
              'Device push notification token (FCM token), used to deliver institutional notifications to your device',
            ]} />

            <p>
              <strong>Important:</strong> {APP_NAME} does not independently collect
              this information from you directly. It retrieves and displays information
              already maintained by {INSTITUTION} in its ERP and administrative systems.
              The accuracy of the information displayed is determined by the records held
              by the Institution.
            </p>
          </Section>

          {/* 3. How We Use Information */}
          <Section id="use" title="3. How We Use Information">
            <p>
              Information accessed through {APP_NAME} may be used for the following
              purposes:
            </p>
            <BulletList items={[
              'Authenticating authorized students and institutional users',
              'Displaying your personal academic information, attendance, and marks',
              'Displaying your timetable, assignments, and syllabus',
              'Displaying institutional fee and financial information',
              'Providing access to library and e-resource services',
              'Delivering institutional announcements and push notifications to your device',
              'Displaying placement and achievement information',
              'Synchronizing your academic records from the Institution\'s ERP system',
              'Maintaining the security and integrity of the application and your account',
              'Detecting and troubleshooting technical problems',
              'Operating and improving institutional digital services',
            ]} />
          </Section>

          {/* 4. Data Sharing */}
          <Section id="sharing" title="4. Data Sharing">
            <p>
              {INSTITUTION} does not sell student personal information to any third party.
            </p>
            <p>
              To operate {APP_NAME}, certain technical services are used. The following
              third-party services may receive limited technical information necessary to
              perform their specific function:
            </p>

            <h3 className="pp-subheading">Firebase Cloud Messaging (Google LLC)</h3>
            <p>
              {APP_NAME} uses Firebase Cloud Messaging (FCM), provided by Google LLC,
              to deliver push notifications to your device. To enable this, a device
              registration token (FCM token) is stored and used to route notifications
              to your specific device. This token does not contain personally identifiable
              student academic data. FCM is governed by Google&rsquo;s privacy policy,
              available at{' '}
              <a
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="pp-link"
              >
                policies.google.com/privacy
              </a>.
            </p>

            <h3 className="pp-subheading">Cloud Database Hosting</h3>
            <p>
              Application data, including student academic records synchronized from
              the Institution&rsquo;s ERP, is stored in a managed cloud PostgreSQL
              database hosted on a cloud infrastructure provider. This provider stores
              data on behalf of the Institution and does not use student data for its
              own purposes.
            </p>

            <h3 className="pp-subheading">No Other Third-Party Sharing</h3>
            <p>
              No other third-party analytics, crash-reporting, advertising, or data-broker
              services have been identified in the {APP_NAME} application at the time this
              policy was authored. Student personal information is not shared with
              advertising networks or external data aggregators.
            </p>

            <p>
              Information may be disclosed if required by applicable law, court order,
              or to protect the safety or rights of students, staff, or the Institution.
            </p>
          </Section>

          {/* 5. Data Storage */}
          <Section id="storage" title="5. Data Storage">
            <p>
              Information processed by {APP_NAME} is stored in the following locations:
            </p>
            <BulletList items={[
              'Academic, profile, and session data is stored in a managed cloud-hosted PostgreSQL database operated on behalf of the Institution.',
              'Session state may also be temporarily cached in an in-memory Redis cache to support fast, secure session lookups.',
              'Uploaded files associated with institutional features (such as achievement images and library materials) are stored on the server\'s local or mounted filesystem, on servers operated on behalf of the Institution.',
              'Push notification tokens (FCM tokens) are stored in the application database to enable delivery of institutional notifications.',
            ]} />
            <p>
              Data is not intentionally stored on your mobile device beyond what is
              necessary for the application to function (such as your session token,
              stored in application memory during an active session).
            </p>
          </Section>

          {/* 6. Data Security */}
          <Section id="security" title="6. Data Security">
            <p>
              {INSTITUTION} and the {APP_NAME} development team use reasonable technical
              and organizational measures to protect information from unauthorized access,
              alteration, disclosure, or destruction. These measures include:
            </p>
            <BulletList items={[
              'HTTPS / TLS encrypted transmission between the application and backend servers',
              'Server-side authentication and session validation on all protected API endpoints',
              'Student passwords stored using cryptographic hashing — plaintext passwords are never stored',
              'Role-based access controls restricting which users and staff can access which information',
              'Rate limiting and request throttling to protect against brute-force and automated attacks',
              'Restricted backend and database access limited to authorized personnel and services',
              'Security audit logging for administrative and sensitive operations',
            ]} />
            <p>
              No method of electronic transmission or storage is 100% secure. While we
              strive to use commercially reasonable means to protect your information,
              we cannot guarantee its absolute security.
            </p>
          </Section>

          {/* 7. Data Retention */}
          <Section id="retention" title="7. Data Retention">
            <p>
              Information is retained for as long as reasonably necessary to:
            </p>
            <BulletList items={[
              'Provide institutional ERP and student services',
              'Maintain accurate academic and administrative records as required by the Institution',
              'Meet applicable legal, regulatory, or statutory record-keeping requirements',
              'Resolve disputes or enforce institutional policies',
              'Address technical, security, or operational issues',
            ]} />
            <p>
              The specific retention periods applicable to different categories of
              institutional records are determined by {INSTITUTION}&rsquo;s internal
              record-keeping policies and applicable educational regulations.
            </p>
          </Section>

          {/* 8. Account and Data Deletion */}
          <Section id="deletion" title="8. Account and Data Deletion">
            <p>
              {APP_NAME} does not currently include a self-service account or data
              deletion feature within the application interface.
            </p>
            <p>
              To request deletion of your account or personal data, please contact
              the Institution directly using the contact information provided in
              Section 12 of this policy:
            </p>
            <div className="pp-highlight-box">
              <p>
                <strong>Privacy / Support Contact:</strong>{' '}
                <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="pp-link">
                  {PRIVACY_CONTACT_EMAIL}
                </a>
              </p>
              <p className="pp-mt-sm">
                Please include your student ID, registered email address, and a clear
                description of your deletion request. Your request will be reviewed
                in accordance with the Institution&rsquo;s applicable policies.
              </p>
            </div>
            <p>
              Please note that some institutional academic and administrative records
              may need to be retained even after an account deletion request, where
              required by the Institution&rsquo;s record-keeping obligations or
              applicable legal requirements. Deletion of your {APP_NAME} account
              does not automatically remove records from the Institution&rsquo;s
              official academic registry.
            </p>
          </Section>

          {/* 9. Children's Privacy */}
          <Section id="children" title="9. Children's Privacy">
            <p>
              {APP_NAME} is an institutional ERP application intended for enrolled
              college students and authorized institutional staff of {INSTITUTION}.
              It is not specifically directed toward children. Access to the
              application is restricted to individuals who have been registered and
              authorized by the Institution.
            </p>
            <p>
              If you believe that a minor has accessed {APP_NAME} without appropriate
              authorization, please contact us using the information in Section 12.
            </p>
          </Section>

          {/* 10. Third-Party Links */}
          <Section id="third-party-links" title="10. Third-Party Links and Services">
            <p>
              {APP_NAME} may contain links to institutional resources, external
              educational platforms, or third-party websites. These linked services
              are not operated by {INSTITUTION} or the {APP_NAME} development team,
              and they maintain their own separate privacy policies.
            </p>
            <p>
              We are not responsible for the content, privacy practices, or security
              of any third-party websites or services. We encourage you to review
              the privacy policy of any external service you access through links
              within {APP_NAME}.
            </p>
          </Section>

          {/* 11. Changes to This Policy */}
          <Section id="changes" title="11. Changes to This Privacy Policy">
            <p>
              This Privacy Policy may be updated when application functionality,
              data practices, the services used, or applicable requirements change.
              When we update this policy, we will revise the Effective Date shown
              at the top of this page.
            </p>
            <p>
              We encourage you to review this Privacy Policy periodically to stay
              informed about how your information is handled. Continued use of
              {' '}{APP_NAME} after any update to this policy constitutes your
              acknowledgement of the revised policy.
            </p>
            <p>
              <strong>Current Effective Date:</strong> {EFFECTIVE_DATE}
            </p>
          </Section>

          {/* 12. Contact Us */}
          <Section id="contact" title="12. Contact Us">
            <p>
              If you have any questions, concerns, or requests regarding this
              Privacy Policy or the handling of your information, please contact us:
            </p>
            <div className="pp-contact-card">
              <div className="pp-contact-row">
                <span className="pp-contact-label">Application</span>
                <span className="pp-contact-value">{APP_NAME}</span>
              </div>
              <div className="pp-contact-row">
                <span className="pp-contact-label">Institution</span>
                <span className="pp-contact-value">{INSTITUTION}</span>
              </div>
              <div className="pp-contact-row">
                <span className="pp-contact-label">Android Package</span>
                <span className="pp-contact-value pp-mono">{ANDROID_PACKAGE}</span>
              </div>
              <div className="pp-contact-row">
                <span className="pp-contact-label">Privacy Contact</span>
                <span className="pp-contact-value">
                  <a
                    href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
                    className="pp-link"
                  >
                    {PRIVACY_CONTACT_EMAIL}
                  </a>
                </span>
              </div>
              <div className="pp-contact-row">
                <span className="pp-contact-label">Support</span>
                <span className="pp-contact-value">
                  <a
                    href={SUPPORT_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pp-link"
                  >
                    {SUPPORT_URL}
                  </a>
                </span>
              </div>
            </div>
          </Section>

        </main>

        {/* ── Footer ─────────────────────────────────────────────────────────── */}
        <footer className="pp-footer" role="contentinfo">
          <div className="pp-footer-inner">
            <p className="pp-footer-copy">
              &copy; {INSTITUTION}. All rights reserved.
            </p>
            <p className="pp-footer-app">
              {APP_NAME} &bull; Privacy Policy
            </p>
            <nav className="pp-footer-nav" aria-label="Footer navigation">
              <Link to="/login" className="pp-footer-link">
                Admin Portal Login
              </Link>
              <span className="pp-footer-sep" aria-hidden="true">&bull;</span>
              <a
                href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
                className="pp-footer-link"
              >
                Contact Support
              </a>
            </nav>
          </div>
        </footer>
      </div>
    </>
  );
}

/* ── Helper: sets document.title for SEO ─────────────────────────────────── */
function TitleSetter() {
  React.useEffect(() => {
    const prev = document.title;
    document.title = `${APP_NAME} Privacy Policy | ${INSTITUTION}`;
    // Attempt to set / update the meta description
    let meta = document.querySelector('meta[name="description"]');
    const prevDesc = meta ? meta.getAttribute('content') : null;
    if (meta) {
      meta.setAttribute(
        'content',
        `Privacy Policy for the ${APP_NAME} student ERP application provided by ${INSTITUTION}.`
      );
    }
    return () => {
      document.title = prev;
      if (meta && prevDesc !== null) {
        meta.setAttribute('content', prevDesc);
      }
    };
  }, []);
  return null;
}

/* ── Table of Contents data ──────────────────────────────────────────────── */
const TOC_ITEMS = [
  { id: 'introduction',      label: '1. Introduction' },
  { id: 'information',       label: '2. Information We May Process' },
  { id: 'use',               label: '3. How We Use Information' },
  { id: 'sharing',           label: '4. Data Sharing' },
  { id: 'storage',           label: '5. Data Storage' },
  { id: 'security',          label: '6. Data Security' },
  { id: 'retention',         label: '7. Data Retention' },
  { id: 'deletion',          label: '8. Account and Data Deletion' },
  { id: 'children',          label: '9. Children\'s Privacy' },
  { id: 'third-party-links', label: '10. Third-Party Links and Services' },
  { id: 'changes',           label: '11. Changes to This Privacy Policy' },
  { id: 'contact',           label: '12. Contact Us' },
];

/* ── Scoped CSS for this public page ────────────────────────────────────── */
/* Tailwind utility classes are available project-wide (loaded in index.css).
   The .pp-* class names below are scoped to this component to avoid any
   conflicts with admin dashboard styles.                                    */
const PRIVACY_POLICY_CSS = `
  /* ── Root & Layout ─────────────────────────────────────────────────────── */
  .pp-root {
    min-height: 100vh;
    background: #f8fafc;
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    color: #111827;
    line-height: 1.7;
    -webkit-font-smoothing: antialiased;
  }
  .pp-container {
    max-width: 820px;
    margin: 0 auto;
    padding: 0 1.25rem;
  }

  /* ── Header ─────────────────────────────────────────────────────────────── */
  .pp-header {
    background: #ffffff;
    border-bottom: 1px solid #e5e7eb;
    box-shadow: 0 1px 4px 0 rgba(0,0,0,0.04);
    position: sticky;
    top: 0;
    z-index: 50;
  }
  .pp-header-inner {
    max-width: 820px;
    margin: 0 auto;
    padding: 0.875rem 1.25rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .pp-header-brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .pp-logo {
    width: 44px;
    height: 44px;
    object-fit: contain;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .pp-header-text {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }
  .pp-header-app {
    font-size: 1rem;
    font-weight: 700;
    color: #111827;
    letter-spacing: -0.01em;
  }
  .pp-header-subtitle {
    font-size: 0.72rem;
    color: #6b7280;
    font-weight: 500;
    margin-top: 1px;
  }
  .pp-header-badge {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: #eff6ff;
    color: #1d4ed8;
    font-size: 0.78rem;
    font-weight: 600;
    padding: 0.35rem 0.85rem;
    border-radius: 999px;
    border: 1px solid #bfdbfe;
    white-space: nowrap;
  }
  .pp-badge-icon { font-size: 0.85rem; }

  /* ── Hero ───────────────────────────────────────────────────────────────── */
  .pp-hero {
    background: linear-gradient(135deg, #1e40af 0%, #1d61e7 60%, #3b82f6 100%);
    color: #ffffff;
    padding: 3rem 0 2.5rem;
    margin-bottom: 2.5rem;
  }
  .pp-hero-title {
    font-size: clamp(1.75rem, 4vw, 2.5rem);
    font-weight: 800;
    letter-spacing: -0.025em;
    margin: 0 0 0.5rem;
    line-height: 1.15;
  }
  .pp-hero-subtitle {
    font-size: 1rem;
    color: rgba(255,255,255,0.85);
    margin: 0 0 1rem;
    font-weight: 500;
  }
  .pp-hero-meta {
    font-size: 0.8rem;
    color: rgba(255,255,255,0.7);
    font-family: 'Courier New', 'Consolas', monospace;
    margin: 0 0 0.35rem;
  }
  .pp-hero-effective {
    font-size: 0.85rem;
    color: rgba(255,255,255,0.8);
    margin: 0;
    font-weight: 500;
  }

  /* ── Table of Contents ──────────────────────────────────────────────────── */
  .pp-toc {
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 1.25rem 1.5rem;
    margin-bottom: 2.5rem;
    box-shadow: 0 1px 4px 0 rgba(0,0,0,0.04);
  }
  .pp-toc-label {
    font-size: 0.7rem;
    font-weight: 700;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0 0 0.75rem;
  }
  .pp-toc-list {
    margin: 0;
    padding-left: 1.1rem;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.3rem 1.5rem;
  }
  @media (max-width: 560px) {
    .pp-toc-list { grid-template-columns: 1fr; }
  }
  .pp-toc-list li { margin: 0; }
  .pp-toc-link {
    font-size: 0.82rem;
    color: #1d61e7;
    text-decoration: none;
    font-weight: 500;
    transition: color 0.15s;
  }
  .pp-toc-link:hover { color: #154ec4; text-decoration: underline; }

  /* ── Main Content ───────────────────────────────────────────────────────── */
  .pp-main {
    padding-bottom: 4rem;
  }
  .pp-section {
    margin-bottom: 2.75rem;
    padding-bottom: 2.75rem;
    border-bottom: 1px solid #f0f0f0;
  }
  .pp-section:last-child {
    border-bottom: none;
    margin-bottom: 0;
  }
  .pp-section-title {
    font-size: 1.2rem;
    font-weight: 700;
    color: #111827;
    margin: 0 0 1rem;
    padding-bottom: 0.6rem;
    border-bottom: 2px solid #1d61e7;
    letter-spacing: -0.01em;
    line-height: 1.3;
  }
  .pp-section-body p {
    font-size: 0.93rem;
    color: #374151;
    margin: 0 0 1rem;
    line-height: 1.75;
  }
  .pp-section-body p:last-child { margin-bottom: 0; }
  .pp-subheading {
    font-size: 0.88rem;
    font-weight: 700;
    color: #1f2937;
    margin: 1.25rem 0 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .pp-list {
    margin: 0.25rem 0 1rem 1.15rem;
    padding: 0;
  }
  .pp-list li {
    font-size: 0.91rem;
    color: #374151;
    margin-bottom: 0.4rem;
    line-height: 1.65;
    padding-left: 0.25rem;
  }

  /* ── Highlight Box (deletion section) ──────────────────────────────────── */
  .pp-highlight-box {
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-left: 4px solid #1d61e7;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin: 1rem 0;
  }
  .pp-highlight-box p {
    margin: 0 !important;
    font-size: 0.91rem;
  }
  .pp-mt-sm { margin-top: 0.5rem !important; }

  /* ── Contact Card ───────────────────────────────────────────────────────── */
  .pp-contact-card {
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    overflow: hidden;
    margin: 1.25rem 0;
    box-shadow: 0 1px 4px 0 rgba(0,0,0,0.04);
  }
  .pp-contact-row {
    display: flex;
    align-items: flex-start;
    padding: 0.85rem 1.25rem;
    border-bottom: 1px solid #f3f4f6;
    gap: 1rem;
    font-size: 0.88rem;
  }
  .pp-contact-row:last-child { border-bottom: none; }
  .pp-contact-label {
    font-weight: 600;
    color: #6b7280;
    min-width: 130px;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding-top: 1px;
    flex-shrink: 0;
  }
  .pp-contact-value {
    color: #111827;
    font-weight: 500;
    word-break: break-all;
  }
  .pp-mono {
    font-family: 'Courier New', 'Consolas', monospace;
    font-size: 0.82rem;
  }

  /* ── Links ──────────────────────────────────────────────────────────────── */
  .pp-link {
    color: #1d61e7;
    text-decoration: none;
    font-weight: 500;
  }
  .pp-link:hover { text-decoration: underline; }

  /* ── Footer ─────────────────────────────────────────────────────────────── */
  .pp-footer {
    background: #1e293b;
    color: #cbd5e1;
    padding: 2rem 0;
    margin-top: 0;
  }
  .pp-footer-inner {
    max-width: 820px;
    margin: 0 auto;
    padding: 0 1.25rem;
    text-align: center;
  }
  .pp-footer-copy {
    font-size: 0.82rem;
    color: #94a3b8;
    margin: 0 0 0.35rem;
    font-weight: 500;
  }
  .pp-footer-app {
    font-size: 0.78rem;
    color: #64748b;
    margin: 0 0 1rem;
  }
  .pp-footer-nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .pp-footer-link {
    font-size: 0.8rem;
    color: #94a3b8;
    text-decoration: none;
    transition: color 0.15s;
  }
  .pp-footer-link:hover { color: #e2e8f0; }
  .pp-footer-sep { color: #475569; font-size: 0.65rem; }

  /* ── Responsive ─────────────────────────────────────────────────────────── */
  @media (max-width: 640px) {
    .pp-hero { padding: 2rem 0 1.75rem; }
    .pp-contact-label { min-width: 90px; }
    .pp-contact-row { padding: 0.75rem 1rem; }
    .pp-toc { padding: 1rem 1.1rem; }
    .pp-header-badge span:last-child { display: none; }
  }
`;
