import React, { useEffect, useRef } from 'react';

const sizeMap = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

/**
 * Modal — accessible, animated modal dialog.
 * Keyboard: ESC to close, Tab/Shift+Tab trapped inside.
 */
export default function Modal({ isOpen, onClose, title, children, size = 'md' }) {
  const panelRef = useRef(null);

  /* Body scroll lock */
  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    else         document.body.style.overflow = '';
    return ()  => { document.body.style.overflow = ''; };
  }, [isOpen]);

  /* ESC handler */
  useEffect(() => {
    if (!isOpen) return;
    const handle = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [isOpen, onClose]);

  /* Focus trap */
  useEffect(() => {
    if (!isOpen || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length) focusable[0].focus();

    const handleTab = (e) => {
      if (e.key !== 'Tab' || !panelRef.current) return;
      const els = [...panelRef.current.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )];
      if (els.length === 0) return;
      const first = els[0];
      const last  = els[els.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [isOpen]);

  if (!isOpen) return null;

  const sizeClass = sizeMap[size] || sizeMap.md;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={`relative bg-white rounded-xl shadow-2xl w-full ${sizeClass} max-h-[90vh] flex flex-col modal-animate`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 id="modal-title" className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="btn-icon ml-2"
            aria-label="Close dialog"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
