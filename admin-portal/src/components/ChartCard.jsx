import React from 'react';

/**
 * Reusable chart wrapper card with title, subtitle, refresh, and optional toolbar.
 */
export default function ChartCard({ title, subtitle, children, toolbar, className = '', height = 240 }) {
  return (
    <div className={`chart-container ${className}`}>
      <div className="section-header">
        <div>
          <h3 className="section-title">{title}</h3>
          {subtitle && <p className="text-[11px] text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
        {toolbar && <div className="flex items-center gap-2">{toolbar}</div>}
      </div>
      <div className="chart-canvas-wrap" style={{ height }}>
        {children}
      </div>
    </div>
  );
}
