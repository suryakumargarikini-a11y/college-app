import React from 'react';

/**
 * EmptyState — reusable empty state card.
 * @param {string}    icon       — Material Symbol name
 * @param {string}    title
 * @param {string}    description
 * @param {ReactNode} action     — optional CTA button/element
 */
export default function EmptyState({ icon = 'inbox', title = 'Nothing here yet', description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
        <span className="material-symbols-outlined text-3xl text-gray-400">{icon}</span>
      </div>
      <h3 className="text-sm font-semibold text-gray-700 mb-1">{title}</h3>
      {description && <p className="text-xs text-gray-400 max-w-xs leading-relaxed">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
