import React, { useEffect, useState, useCallback, useMemo } from 'react';
import api from '../lib/api';
import Modal from '../components/Modal';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import SearchInput from '../components/SearchInput';
import Badge from '../components/Badge';
import ToastContainer from '../components/Toast';
import { useToast } from '../hooks/useToast';

const STATUS_TABS = ['ALL', 'PENDING', 'APPROVED', 'REJECTED'];

function SkeletonRows({ n = 5 }) {
  return [...Array(n)].map((_, i) => (
    <tr key={i} className="border-b border-gray-100">
      <td className="px-4 py-3"><div className="skeleton h-4 w-32 rounded mb-1" /><div className="skeleton h-3 w-20 rounded" /></td>
      <td className="px-4 py-3"><div className="skeleton h-3 w-40 rounded" /></td>
      <td className="px-4 py-3"><div className="skeleton h-3 w-28 rounded" /></td>
      <td className="px-4 py-3"><div className="skeleton h-3 w-24 rounded" /></td>
      <td className="px-4 py-3"><div className="skeleton h-5 w-20 rounded-full" /></td>
      <td className="px-4 py-3"><div className="skeleton h-7 w-28 rounded" /></td>
    </tr>
  ));
}

export default function ExitPasses() {
  const { toasts, showToast, removeToast } = useToast();
  const [items,      setItems]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [activeTab,  setActiveTab]  = useState('ALL');
  const [search,     setSearch]     = useState('');
  const [approveTarget, setApproveTarget] = useState(null);
  const [approving,     setApproving]     = useState(false);
  const [approvedOtp,   setApprovedOtp]   = useState('');
  const [rejectTarget,  setRejectTarget]  = useState(null);
  const [rejectReason,  setRejectReason]  = useState('');
  const [rejecting,     setRejecting]     = useState(false);
  const [otpTarget,     setOtpTarget]     = useState(null);
  const [verifyOtp,     setVerifyOtp]     = useState('');
  const [verifyResult,  setVerifyResult]  = useState(null);
  const [verifying,     setVerifying]     = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const params = activeTab !== 'ALL' ? `?status=${activeTab}` : '';
    api.get(`/admin/exit-passes${params}`)
      .then(r => setItems(r.data))
      .catch(() => showToast('Failed to load exit passes', 'error'))
      .finally(() => setLoading(false));
  }, [activeTab]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let list = activeTab === 'ALL' ? items : items.filter(i => i.status === activeTab);
    if (search) list = list.filter(i =>
      i.student?.name?.toLowerCase().includes(search.toLowerCase()) ||
      i.student?.roll?.toLowerCase().includes(search.toLowerCase()) ||
      i.destination?.toLowerCase().includes(search.toLowerCase())
    );
    return list;
  }, [items, activeTab, search]);

  const handleApprove = async () => {
    setApproving(true);
    try {
      const res = await api.post(`/admin/exit-passes/${approveTarget.id}/approve`);
      setApprovedOtp(res.data.otp || res.data.exitPass?.otp || '');
      showToast('Exit pass approved');
      load();
    } catch (err) { showToast(err.response?.data?.error || 'Failed to approve', 'error'); setApproveTarget(null); }
    finally { setApproving(false); }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    setRejecting(true);
    try {
      await api.post(`/admin/exit-passes/${rejectTarget.id}/reject`, { reason: rejectReason });
      showToast('Exit pass rejected');
      setRejectTarget(null); setRejectReason(''); load();
    } catch (err) { showToast(err.response?.data?.error || 'Failed to reject', 'error'); }
    finally { setRejecting(false); }
  };

  const handleVerifyOtp = async () => {
    if (!verifyOtp.trim()) return;
    setVerifying(true); setVerifyResult(null);
    try {
      const res = await api.post('/admin/exit-passes/verify-otp', { otp: verifyOtp });
      setVerifyResult({ success: true, data: res.data });
    } catch (err) { setVerifyResult({ success: false, message: err.response?.data?.error || 'Invalid or expired OTP' }); }
    finally { setVerifying(false); }
  };

  return (
    <div className="space-y-5 fade-in">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* ── Gate OTP Verification Panel ── */}
      <div className="card p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-blue-50 flex items-center justify-center">
            <span className="material-symbols-outlined text-blue-600 text-[15px]">verified</span>
          </span>
          Gate OTP Verification
        </h3>
        <div className="flex flex-wrap gap-3 items-start">
          <div className="flex-1 max-w-xs min-w-[180px]">
            <input
              className="input-field h-9"
              placeholder="Enter 6-digit OTP"
              value={verifyOtp}
              onChange={e => { setVerifyOtp(e.target.value); setVerifyResult(null); }}
              maxLength={8}
            />
          </div>
          <button onClick={handleVerifyOtp} className="btn-primary h-9" disabled={verifying || !verifyOtp.trim()}>
            {verifying
              ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <span className="material-symbols-outlined text-[17px]">qr_code_scanner</span>}
            Verify
          </button>
          {verifyResult && (
            <div className={`flex items-start gap-2 px-3 py-2 rounded-lg text-sm border ${verifyResult.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
              <span className="material-symbols-outlined text-[18px]">{verifyResult.success ? 'check_circle' : 'cancel'}</span>
              <div>
                {verifyResult.success ? (
                  <>
                    <p className="font-semibold text-xs">Valid OTP ✓</p>
                    {verifyResult.data?.student && <p className="text-[11px] mt-0.5">{verifyResult.data.student.name} • {verifyResult.data.student.roll}</p>}
                    {verifyResult.data?.destination && <p className="text-[11px]">To: {verifyResult.data.destination}</p>}
                  </>
                ) : <p className="text-xs">{verifyResult.message}</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      <PageHeader
        title="Exit Passes"
        subtitle={`${items.length} total requests`}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Search student or destination…" />
            <button onClick={load} className="btn-secondary h-9">
              <span className="material-symbols-outlined text-[17px]">refresh</span>
              Refresh
            </button>
          </>
        }
      />

      {/* Status Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {STATUS_TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all ${activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {tab}
            {tab !== 'ALL' && <span className={`ml-1.5 ${activeTab === tab ? 'text-gray-400' : 'text-gray-300'}`}>({items.filter(i => i.status === tab).length})</span>}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="overflow-x-auto"><table className="table-base"><thead><tr><th className="th">Student</th><th className="th">Reason</th><th className="th">Destination</th><th className="th">Requested</th><th className="th">Status</th><th className="th text-right">Actions</th></tr></thead><tbody><SkeletonRows /></tbody></table></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="exit_to_app" title={search || activeTab !== 'ALL' ? 'No matching passes' : 'No exit pass requests'} description={activeTab === 'PENDING' ? 'All pending passes have been reviewed.' : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="th">Student</th><th className="th">Reason</th><th className="th">Destination</th>
                  <th className="th">Requested</th><th className="th">Status</th><th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => (
                  <tr key={item.id} className="tr-hover">
                    <td className="td">
                      <p className="font-semibold text-gray-900 text-sm">{item.student?.name || '—'}</p>
                      <p className="text-xs text-gray-400 font-mono">{item.student?.roll || item.student?.rollNo}</p>
                    </td>
                    <td className="td text-xs text-gray-600 max-w-[150px] truncate">{item.reason}</td>
                    <td className="td text-sm text-gray-700">{item.destination}</td>
                    <td className="td text-xs text-gray-400 whitespace-nowrap">{item.createdAt ? new Date(item.createdAt).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—'}</td>
                    <td className="td"><Badge value={item.status} /></td>
                    <td className="td">
                      <div className="flex items-center gap-1.5 justify-end">
                        {item.status === 'PENDING' && (
                          <>
                            <button onClick={() => { setApproveTarget(item); setApprovedOtp(''); }} className="text-xs px-2.5 py-1 rounded-md bg-green-50 hover:bg-green-100 text-green-700 font-semibold transition-colors">Approve</button>
                            <button onClick={() => { setRejectTarget(item); setRejectReason(''); }} className="text-xs px-2.5 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-600 font-semibold transition-colors">Reject</button>
                          </>
                        )}
                        {item.status === 'APPROVED' && item.otp && (
                          <button onClick={() => setOtpTarget(item)} className="text-xs px-2.5 py-1 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold transition-colors flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px]">key</span> OTP
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

      {/* Approve Confirmation Modal */}
      <Modal isOpen={!!approveTarget && !approvedOtp} onClose={() => setApproveTarget(null)} title="Approve Exit Pass" size="sm">
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <p className="text-sm font-bold text-blue-900">{approveTarget?.student?.name}</p>
            <p className="text-xs text-blue-600 mt-0.5 font-mono">{approveTarget?.student?.roll}</p>
            <p className="text-xs text-blue-700 mt-2">Destination: <span className="font-semibold">{approveTarget?.destination}</span></p>
            <p className="text-xs text-blue-700">Reason: <span className="font-semibold">{approveTarget?.reason}</span></p>
          </div>
          <p className="text-xs text-gray-500">Approving will generate a one-time OTP for the student to use at the gate.</p>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setApproveTarget(null)} className="btn-secondary">Cancel</button>
            <button onClick={handleApprove} className="btn-success flex items-center gap-2" disabled={approving}>
              {approving && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {approving ? 'Approving…' : 'Approve & Generate OTP'}
            </button>
          </div>
        </div>
      </Modal>

      {/* OTP Result Modal */}
      <Modal isOpen={!!approveTarget && !!approvedOtp} onClose={() => { setApproveTarget(null); setApprovedOtp(''); }} title="Exit Pass Approved" size="sm">
        <div className="space-y-4">
          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
            <span className="material-symbols-outlined text-emerald-600 text-3xl">check_circle</span>
            <p className="text-sm font-semibold text-emerald-800">Exit pass approved successfully</p>
          </div>
          <div className="text-center py-4">
            <p className="text-xs text-gray-400 mb-3">One-Time Password for Student</p>
            <div className="inline-block px-8 py-4 bg-gray-900 text-white rounded-2xl">
              <p className="text-4xl font-bold tracking-[0.4em] font-mono">{approvedOtp}</p>
            </div>
            <p className="text-xs text-gray-400 mt-3">Valid for 24 hours — share with student</p>
          </div>
          <button onClick={() => { setApproveTarget(null); setApprovedOtp(''); }} className="btn-primary w-full">Done</button>
        </div>
      </Modal>

      {/* Show OTP Modal */}
      <Modal isOpen={!!otpTarget} onClose={() => setOtpTarget(null)} title="Exit Pass OTP" size="sm">
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <p className="text-sm font-bold text-blue-900">{otpTarget?.student?.name}</p>
            <p className="text-xs text-blue-700 mt-0.5">Destination: {otpTarget?.destination}</p>
          </div>
          <div className="text-center py-3">
            <p className="text-xs text-gray-400 mb-3">Current OTP</p>
            <div className="inline-block px-8 py-4 bg-gray-900 text-white rounded-2xl">
              <p className="text-4xl font-bold tracking-[0.4em] font-mono">{otpTarget?.otp}</p>
            </div>
          </div>
          <button onClick={() => setOtpTarget(null)} className="btn-secondary w-full">Close</button>
        </div>
      </Modal>

      {/* Reject Modal */}
      <Modal isOpen={!!rejectTarget} onClose={() => setRejectTarget(null)} title="Reject Exit Pass" size="sm">
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-100 rounded-xl p-4">
            <p className="text-sm font-bold text-red-900">{rejectTarget?.student?.name}</p>
            <p className="text-xs text-red-700 mt-0.5 font-mono">{rejectTarget?.student?.roll}</p>
            <p className="text-xs text-red-700 mt-2">Destination: {rejectTarget?.destination}</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Reason for Rejection *</label>
            <textarea className="input-field h-24 resize-none" placeholder="Provide a reason for rejection…" value={rejectReason} onChange={e => setRejectReason(e.target.value)} autoFocus />
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setRejectTarget(null)} className="btn-secondary">Cancel</button>
            <button onClick={handleReject} className="btn-danger flex items-center gap-2" disabled={rejecting || !rejectReason.trim()}>
              {rejecting && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {rejecting ? 'Rejecting…' : 'Reject Pass'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
