import React, { useRef, useEffect } from 'react';

/**
 * SearchInput — debounced search field with clear button.
 * @param {string}   value
 * @param {function} onChange(value: string)
 * @param {string}   placeholder
 * @param {boolean}  autoFocus
 */
export default function SearchInput({ value, onChange, placeholder = 'Search…', autoFocus = false }) {
  const ref = useRef(null);

  useEffect(() => {
    if (autoFocus && ref.current) ref.current.focus();
  }, [autoFocus]);

  return (
    <div className="relative">
      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none select-none text-[18px]">
        search
      </span>
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="input-field pl-9 pr-8 h-9 text-sm w-full min-w-[200px]"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Clear search"
        >
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      )}
    </div>
  );
}
