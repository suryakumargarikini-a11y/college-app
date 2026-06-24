import React, { useEffect, useState, useCallback } from 'react';
import api from '../lib/api';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

const STATUS_TABS = ['ALL', 'PENDING', 'APPROVED', 'REJECTED'];

export default function ExitPasses() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ALL');
  const [toast, setToast] = useState('');

  // Approve modal
  const [approveTarget, setApproveTarget] = useState(null);
  const [approving, setApproving] = useState(false);
  const [approvedOtp, setApprovedOtp] = useState('');

  // Reject modal
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  // OTP display modal
  const [otpTarget, setOtpTarget] = useState(null);

  // Gate verify
  const [verifyOtp, setVerifyOtp] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifying, setVerifying] = useState(false);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const load = useCallback(() => {
    setLoading(true);
    const params = activeTab !== 'ALL' ? `?status=${activeTab}` : '';
    api.get(`/admin/exit-passes${params}`)
      .then(r => setItems(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeTab]);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async () => {
    setApproving(true);
    try {
      const res = await api.post(`/admin/exit-passes/${approveTarget.id}/approve`);
      setApprovedOtp(res.data.otp || res.data.exitPass?.otp || '');
      showToast('Exit pass approved');
      load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to approve');
      setApproveTarget(null);
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    setRejecting(true);
    try {
      await api.post(`/admin/exit-passes/${rejectTarget.id}/reject`, { reason: rejectReason });
      showToast('Exit pass rejected');
      setRejectTarget(null);
      setRejectReason('');
      load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to reject');
    } finally {
      setRejecting(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!verifyOtp.trim()) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await api.post('/admin/exit-passes/verify-otp', { otp: verifyOtp });
      setVerifyResult({ success: true, data: res.data });
    } catch (err) {
      setVerifyResult({
        success: false,
        message: err.response?.data?.error || 'Invalid or expired OTP',
      });
    } finally {
      setVerifying(false);
    }
  };

  const filteredItems = activeTab === 'ALL' ? items : items.filter(i => i.status === activeTab);

  const statusColor = {
    PENDING: 'badge-pending',
    APPROVED: 'badge-approved',
    REJECTED: 'badge-rejected',
    USED: 'badge-used',
  };

  return (
    <div className="space-y-5">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white px-4 py-2 rounded-lg text-sm shadow-lg">
          {toast}
        </div>
      )}

      {/* Gate Verify Panel */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-blue-600" style={{ fontSize: '18px' }}>verified</span>
          Gate OTP Verification
        </h3>
        <div className="flex gap-3 items-start">
          <div className="flex-1 max-w-xs">
            <input
              className="input-field"
              placeholder="Enter 6-digit OTP"
              value={verifyOtp}
              onChange={e => {
                setVerifyOtp(e.target.value);
                setVerifyResult(null);
              }}
              maxLength={8}
            />
          </div>
          <button
            onClick={handleVerifyOtp}
            className="btn-primary flex items-center gap-2"
            disabled={verifying || !verifyOtp.trim()}
          >
            {verifying ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>qr_code_scanner</span>
            )}
            Verify
          </button>
          {verifyResult && (
            <div className={`flex items-start gap-2 px-3 py-2 rounded-lg text-sm ${
              verifyResult.success
                ? 'bg-green-50 border border-green-200 text-green-800'
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}>
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                {verifyResult.success ? 'check_circle' : 'cancel'}
              </span>
              <div>
                {verifyResult.success ? (
                  <>
                    <p className="font-semibold">Valid OTP ✓</p>
                    {verifyResult.data?.student && (
                      <p className="text-xs mt-0.5">
                        {verifyResult.data.student.name} • {verifyResult.data.student.roll}
                      </p>
                    )}
                    {verifyResult.data?.destination && (
                      <p className="text-xs">Destination: {verifyResult.data.destination}</p>
                    )}
                  </>
                ) : (
                  <p>{verifyResult.message}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Header + Tabs */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Exit Passes</h2>
            <p className="text-sm text-gray-500">{items.length} total requests</p>
          </div>
          <button onClick={load} className="btn-secondary flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>refresh</span>
            Refresh
          </button>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {STATUS_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab}
              {tab !== 'ALL' && (
                <span className={`ml-1.5 text-xs ${activeTab === tab ? 'text-gray-500' : 'text-gray-400'}`}>
                  ({items.filter(i => i.status === tab).length})
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-gray-300 text-5xl block">exit_to_app</span>
            <p className="text-sm text-gray-500 mt-2">No {activeTab !== 'ALL' ? activeTab.toLowerCase() : ''} exit pass requests</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Student</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Reason</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Destination</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Requested</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredItems.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">{item.student?.name || '—'}</p>
                      <p className="text-xs text-gray-500">{item.student?.roll || item.student?.rollNo}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-[150px] truncate">{item.reason}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{item.destination}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={statusColor[item.status] || 'badge-draft'}>{item.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        {item.status === 'PENDING' && (
                          <>
                            <button
                              onClick={() => { setApproveTarget(item); setApprovedOtp(''); }}
                              className="text-xs px-2 py-1 rounded bg-green-50 hover:bg-green-100 text-green-700 font-medium transition-colors"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => { setRejectTarget(item); setRejectReason(''); }}
                              className="text-xs px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-600 font-medium transition-colors"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {item.status === 'APPROVED' && item.otp && (
                          <button
                            onClick={() => setOtpTarget(item)}
                            className="text-xs px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium transition-colors flex items-center gap-1"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>key</span>
                            Show OTP
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Approve Modal */}
      <Modal
        isOpen={!!approveTarget && !approvedOtp}
        onClose={() => setApproveTarget(null)}
        title="Approve Exit Pass"
        size="sm"
      >
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm font-medium text-blue-900">{approveTarget?.student?.name}</p>
            <p className="text-xs text-blue-700 mt-0.5">{approveTarget?.student?.roll}</p>
            <p className="text-xs text-blue-700 mt-1">Destination: <span className="font-medium">{approveTarget?.destination}</span></p>
            <p className="text-xs text-blue-700">Reason: <span className="font-medium">{approveTarget?.reason}</span></p>
          </div>
          <p className="text-sm text-gray-600">
            Approving this request will generate a one-time OTP for the student to use at the gate.
          </p>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setApproveTarget(null)} className="btn-secondary">Cancel</button>
            <button onClick={handleApprove} className="btn-success flex items-center gap-2" disabled={approving}>
              {approving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {approving ? 'Approving...' : 'Approve & Generate OTP'}
            </button>
          </div>
        </div>
      </Modal>

      {/* OTP Result Modal */}
      <Modal
        isOpen={!!approveTarget && !!approvedOtp}
        onClose={() => { setApproveTarget(null); setApprovedOtp(''); }}
        title="Exit Pass Approved"
        size="sm"
      >
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
            <span className="material-symbols-outlined text-green-600 text-3xl block">check_circle</span>
            <p className="text-sm font-medium text-green-800 mt-1">Exit pass approved successfully</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-2">Generated OTP for student</p>
            <div className="inline-block px-6 py-3 bg-gray-900 text-white rounded-xl">
              <p className="text-3xl font-bold tracking-[0.3em] font-mono">{approvedOtp}</p>
            </div>
            <p className="text-xs text-gray-400 mt-2">Share this OTP with the student or they can view it in the app</p>
          </div>
          <button
            onClick={() => { setApproveTarget(null); setApprovedOtp(''); }}
            className="btn-primary w-full"
          >
            Done
          </button>
        </div>
      </Modal>

      {/* Show OTP Modal (for already approved) */}
      <Modal
        isOpen={!!otpTarget}
        onClose={() => setOtpTarget(null)}
        title="Exit Pass OTP"
        size="sm"
      >
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm font-medium text-blue-900">{otpTarget?.student?.name}</p>
            <p className="text-xs text-blue-700 mt-0.5">Destination: {otpTarget?.destination}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-2">Current OTP</p>
            <div className="inline-block px-6 py-3 bg-gray-900 text-white rounded-xl">
              <p className="text-3xl font-bold tracking-[0.3em] font-mono">{otpTarget?.otp}</p>
            </div>
          </div>
          <button onClick={() => setOtpTarget(null)} className="btn-secondary w-full">Close</button>
        </div>
      </Modal>

      {/* Reject Modal */}
      <Modal
        isOpen={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        title="Reject Exit Pass"
        size="sm"
      >
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-sm font-medium text-red-900">{rejectTarget?.student?.name}</p>
            <p className="text-xs text-red-700 mt-0.5">{rejectTarget?.student?.roll}</p>
            <p className="text-xs text-red-700 mt-1">Destination: {rejectTarget?.destination}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason for Rejection *</label>
            <textarea
              className="input-field h-24 resize-none"
              placeholder="Provide a reason for rejection..."
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setRejectTarget(null)} className="btn-secondary">Cancel</button>
            <button
              onClick={handleReject}
              className="btn-danger flex items-center gap-2"
              disabled={rejecting || !rejectReason.trim()}
            >
              {rejecting && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {rejecting ? 'Rejecting...' : 'Reject Pass'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
