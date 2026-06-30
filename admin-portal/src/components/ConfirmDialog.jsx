import React from 'react';
import Modal from './Modal';

/**
 * ConfirmDialog — destructive action confirmation modal.
 * Adds a warning icon and colour-coded border based on the `danger` prop.
 */
export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  danger = false,
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <div className="space-y-4">
        {/* Icon row */}
        <div className={`flex items-center gap-3 p-3 rounded-lg ${danger ? 'bg-red-50' : 'bg-amber-50'}`}>
          <span className={`material-symbols-outlined text-2xl flex-shrink-0 ${danger ? 'text-red-500' : 'text-amber-500'}`}>
            {danger ? 'delete_forever' : 'warning'}
          </span>
          <p className="text-sm text-gray-700 leading-snug">{message}</p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end pt-1">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={onConfirm} className={danger ? 'btn-danger' : 'btn-primary'}>
            {confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}
