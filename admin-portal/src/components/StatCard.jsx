import React from 'react';

/**
 * StatCard — dashboard metric card.
 * @param {string}  title
 * @param {*}       value
 * @param {string}  icon      — Material Symbol name
 * @param {string}  color     — blue | green | yellow | red | indigo | emerald | violet
 * @param {string}  subtitle
 * @param {boolean} loading   — shows skeleton shimmer when true
 * @param {string}  trend     — optional e.g. '+12%' (positive) or '-3%' (negative)
 */
const colorMap = {
  blue:    { bg: 'bg-blue-50',    text: 'text-blue-600'   },
  green:   { bg: 'bg-green-50',   text: 'text-green-600'  },
  yellow:  { bg: 'bg-amber-50',   text: 'text-amber-600'  },
  red:     { bg: 'bg-red-50',     text: 'text-red-600'    },
  indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-600' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600'},
  violet:  { bg: 'bg-violet-50',  text: 'text-violet-600' },
};

export default function StatCard({ title, value, icon, color = 'blue', subtitle, loading, trend }) {
  const { bg, text } = colorMap[color] || colorMap.blue;

  if (loading) {
    return (
      <div className="card p-5 fade-in">
        <div className="flex items-center justify-between">
          <div className="space-y-2 flex-1">
            <div className="skeleton h-3 w-24 rounded" />
            <div className="skeleton h-7 w-16 rounded" />
            <div className="skeleton h-3 w-32 rounded" />
          </div>
          <div className="skeleton w-11 h-11 rounded-xl flex-shrink-0" />
        </div>
      </div>
    );
  }

  const isPositive = trend && !trend.startsWith('-');

  return (
    <div className="card p-5 hover:shadow-md transition-shadow duration-200 fade-in">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide leading-none">{title}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1.5 leading-none tabular-nums">{value ?? '—'}</p>
          {subtitle && <p className="text-xs text-gray-400 mt-1.5 leading-snug">{subtitle}</p>}
          {trend && (
            <p className={`text-xs font-semibold mt-1.5 flex items-center gap-0.5 ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
              <span className="material-symbols-outlined text-[13px]">
                {isPositive ? 'trending_up' : 'trending_down'}
              </span>
              {trend}
            </p>
          )}
        </div>
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${bg}`}>
          <span className={`material-symbols-outlined text-[22px] ${text}`}>{icon}</span>
        </div>
      </div>
    </div>
  );
}
