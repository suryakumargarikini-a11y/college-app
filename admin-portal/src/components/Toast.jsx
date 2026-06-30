import React from 'react';

const CONFIG = {
  success: {
    icon: 'check_circle',
    cls: 'bg-white border-l-4 border-emerald-500 text-gray-800',
    iconCls: 'text-emerald-500',
  },
  error: {
    icon: 'error',
    cls: 'bg-white border-l-4 border-red-500 text-gray-800',
    iconCls: 'text-red-500',
  },
  info: {
    icon: 'info',
    cls: 'bg-white border-l-4 border-blue-500 text-gray-800',
    iconCls: 'text-blue-500',
  },
  warning: {
    icon: 'warning',
    cls: 'bg-white border-l-4 border-amber-500 text-gray-800',
    iconCls: 'text-amber-500',
  },
};

function ToastItem({ toast, onRemove }) {
  const { icon, cls, iconCls } = CONFIG[toast.type] || CONFIG.info;
  return (
    <div
      className={`toast-enter flex items-start gap-3 px-4 py-3 rounded-lg shadow-lg border border-gray-100 min-w-[280px] max-w-[360px] ${cls}`}
      role="alert"
    >
      <span className={`material-symbols-outlined text-xl flex-shrink-0 mt-0.5 ${iconCls}`}>
        {icon}
      </span>
      <p className="text-sm font-medium flex-1 leading-relaxed">{toast.message}</p>
      <button
        onClick={() => onRemove(toast.id)}
        className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors ml-1 mt-0.5"
        aria-label="Dismiss"
      >
        <span className="material-symbols-outlined text-lg">close</span>
      </button>
    </div>
  );
}

/**
 * ToastContainer — render at root of a page/layout.
 * Props: toasts (array), onRemove (fn)
 */
export default function ToastContainer({ toasts, onRemove }) {
  if (!toasts || toasts.length === 0) return null;
  return (
    <div
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onRemove={onRemove} />
      ))}
    </div>
  );
}
