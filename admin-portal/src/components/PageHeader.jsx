import React from 'react';

/**
 * PageHeader — reusable page-level header.
 * @param {string}    title
 * @param {string}    subtitle
 * @param {ReactNode} actions  — right-side slot (buttons, etc.)
 */
export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
      <div>
        <h2 className="text-lg font-bold text-gray-900 leading-tight">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
