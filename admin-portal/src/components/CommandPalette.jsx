import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const COMMANDS = [
  { label: 'Dashboard',           icon: 'dashboard',              path: '/dashboard',             category: 'Navigate' },
  { label: 'Student Registry',    icon: 'groups',                 path: '/students',              category: 'Navigate' },
  { label: 'Faculty',             icon: 'school',                 path: '/faculty',               category: 'Navigate' },
  { label: 'Attendance Analytics',icon: 'event_available',        path: '/attendance-dashboard',  category: 'Navigate' },
  { label: 'Marks Ledger',        icon: 'grading',                path: '/marks-ledger',          category: 'Navigate' },
  { label: 'Fees Dashboard',      icon: 'account_balance_wallet', path: '/fees-dashboard',        category: 'Navigate' },
  { label: 'Placements Dashboard',icon: 'analytics',              path: '/placements-dashboard',  category: 'Navigate' },
  { label: 'LMS Dashboard',       icon: 'import_contacts',        path: '/lms-dashboard',         category: 'Navigate' },
  { label: 'Executive Analytics', icon: 'insights',               path: '/analytics',             category: 'Navigate' },
  { label: 'Risk Dashboard',      icon: 'warning',                path: '/risk-dashboard',        category: 'Navigate' },
  { label: 'Activity Center',     icon: 'timeline',               path: '/activity-center',       category: 'Navigate' },
  { label: 'Announcements',       icon: 'campaign',               path: '/announcements',         category: 'Navigate' },
  { label: 'Placement Drives',    icon: 'work',                   path: '/placements',            category: 'Navigate' },
  { label: 'Fee Notices',         icon: 'receipt_long',           path: '/fee-notices',           category: 'Navigate' },
  { label: 'Exit Passes',         icon: 'exit_to_app',            path: '/exit-passes',           category: 'Navigate' },
  { label: 'Notifications',       icon: 'notifications',          path: '/notifications',         category: 'Navigate' },
  { label: 'Settings',            icon: 'settings',               path: '/settings',              category: 'Navigate' },
];

export default function CommandPalette({ open, onClose }) {
  const [query, setQuery]       = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (open) { setQuery(''); setSelected(0); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); open ? onClose() : null; }
      if (!open) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
      if (e.key === 'Enter')     { e.preventDefault(); execCommand(filtered[selected]); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const filtered = COMMANDS.filter(c =>
    c.label.toLowerCase().includes(query.toLowerCase()) ||
    c.category.toLowerCase().includes(query.toLowerCase())
  );

  const execCommand = useCallback((cmd) => {
    if (!cmd) return;
    navigate(cmd.path);
    onClose();
  }, [navigate, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="cmd-backdrop" onClick={onClose} />
      <div className="cmd-box">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <span className="material-symbols-outlined text-[20px] text-gray-400">search</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(0); }}
            placeholder="Search pages, analytics, reports…"
            className="flex-1 text-sm text-gray-900 bg-transparent outline-none placeholder:text-gray-400"
          />
          <kbd className="px-2 py-0.5 text-[10px] font-mono bg-gray-100 rounded border border-gray-200 text-gray-400">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              <span className="material-symbols-outlined text-3xl block mb-2">search_off</span>
              No results for "{query}"
            </div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.path}
                onClick={() => execCommand(cmd)}
                onMouseEnter={() => setSelected(i)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  selected === i ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className={`material-symbols-outlined text-[18px] ${selected === i ? 'text-blue-600' : 'text-gray-400'}`}>
                  {cmd.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate">{cmd.label}</span>
                </div>
                <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded font-medium">{cmd.category}</span>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-4 px-4 py-2.5 border-t border-gray-100 text-[10px] text-gray-400">
          <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-gray-100 rounded border border-gray-200">↑↓</kbd> Navigate</span>
          <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-gray-100 rounded border border-gray-200">↵</kbd> Open</span>
          <span className="ml-auto">SITAM ERP Command Center</span>
        </div>
      </div>
    </>
  );
}
