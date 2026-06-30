import React from 'react';

const VARIANTS = {
  draft:     'bg-gray-50  text-gray-600  border-gray-200',
  published: 'bg-green-50 text-green-700 border-green-200',
  closed:    'bg-red-50   text-red-700   border-red-200',
  pending:   'bg-amber-50 text-amber-700 border-amber-200',
  approved:  'bg-blue-50  text-blue-700  border-blue-200',
  rejected:  'bg-red-50   text-red-600   border-red-200',
  used:      'bg-gray-50  text-gray-500  border-gray-200',
  expired:   'bg-orange-50 text-orange-700 border-orange-200',
  high:      'bg-red-50   text-red-700   border-red-200',
  normal:    'bg-blue-50  text-blue-600  border-blue-200',
  low:       'bg-gray-50  text-gray-500  border-gray-200',
  active:    'bg-green-50 text-green-700 border-green-200',
  inactive:  'bg-gray-50  text-gray-500  border-gray-200',
  upcoming:  'bg-violet-50 text-violet-700 border-violet-200',
  info:      'bg-sky-50   text-sky-700   border-sky-200',
};

/**
 * Badge — centralised status badge component.
 * @param {string} value  — the status string (will be lower-cased to pick variant)
 * @param {string} label  — optional override display label
 */
export default function Badge({ value = '', label }) {
  const key = value.toLowerCase().replace(/[^a-z]/g, '');
  const cls = VARIANTS[key] || 'bg-gray-50 text-gray-600 border-gray-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>
      {label ?? value}
    </span>
  );
}
