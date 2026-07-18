import React, { useEffect, useState, useCallback } from 'react';
import api from '../lib/api';
import Modal from '../components/Modal';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import SearchInput from '../components/SearchInput';
import Badge from '../components/Badge';
import ToastContainer from '../components/Toast';
import { useToast } from '../hooks/useToast';

const STATUS_TABS = ['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'USED', 'EXPIRED'];

function SkeletonRows({ n = 5, cols = 6 }) {
  return [...Array(n)].map((_, i) => (
    <tr key={i} className="border-b border-gray-100">
      {[...Array(cols)].map((_, j) => (
        <td key={j} className="px-4 py-3">
          <div className="skeleton h-4 w-28 rounded mb-1" />
        </td>
      ))}
    </tr>
  ));
}

export default function ExitPasses() {
  const { toasts, showToast, removeToast } = useToast();
  
  // Main view toggles
  const [activeMainTab, setActiveMainTab] = useState('INDIVIDUAL'); // INDIVIDUAL or GROUP
  const [activeTab, setActiveTab] = useState('ALL');
  const [search, setSearch] = useState('');
  
  // Lists data
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [groupItems, setGroupItems] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(false);

  // Single approval modal states
  const [approveTarget, setApproveTarget] = useState(null);
  const [approving, setApproving] = useState(false);
  const [approvedOtp, setApprovedOtp] = useState('');
  const [adminRemark, setAdminRemark] = useState('');
  
  // Quota states (fetched dynamically for the student being approved)
  const [studentQuota, setStudentQuota] = useState(null);
  const [loadingQuota, setLoadingQuota] = useState(false);

  // Single reject modal states
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  // Group request action states
  const [approveGroupTarget, setApproveGroupTarget] = useState(null);
  const [approvingGroup, setApprovingGroup] = useState(false);
  const [rejectGroupTarget, setRejectGroupTarget] = useState(null);
  const [groupRejectReason, setGroupRejectReason] = useState('');
  const [rejectingGroup, setRejectingGroup] = useState(false);

  // OTP Verification modal states (for quick lookups)
  const [verifyOtp, setVerifyOtp] = useState('');
  const [verifyRoll, setVerifyRoll] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifying, setVerifying] = useState(false);
  
  // Load Individual Passes
  const load = useCallback(() => {
    setLoading(true);
    const statusParam = activeTab !== 'ALL' ? `status=${activeTab}` : '';
    const searchParam = search ? `search=${encodeURIComponent(search)}` : '';
    const query = [statusParam, searchParam].filter(Boolean).join('&');
    const url = `/admin/exit-passes${query ? '?' + query : ''}`;

    api.get(url)
      .then(r => setItems(r.data))
      .catch(() => showToast('Failed to load exit passes', 'error'))
      .finally(() => setLoading(false));
  }, [activeTab, search]);

  // Load Group Requests
  const loadGroups = useCallback(() => {
    setLoadingGroups(true);
    const statusParam = activeTab !== 'ALL' ? `status=${activeTab}` : '';
    const url = `/admin/exit-passes/groups${statusParam ? '?' + statusParam : ''}`;

    api.get(url)
      .then(r => setGroupItems(r.data))
      .catch(() => showToast('Failed to load group requests', 'error'))
      .finally(() => setLoadingGroups(false));
  }, [activeTab]);

  useEffect(() => {
    if (activeMainTab === 'INDIVIDUAL') {
      const delay = setTimeout(() => {
        load();
      }, 300);
      return () => clearTimeout(delay);
    } else {
      loadGroups();
    }
  }, [activeMainTab, activeTab, search, load, loadGroups]);

  // Fetch Student Quota for approval checks
  useEffect(() => {
    if (approveTarget && approveTarget.studentId) {
      setLoadingQuota(true);
      setStudentQuota(null);
      api.get(`/admin/exit-passes/quota/${approveTarget.studentId}`)
        .then(r => setStudentQuota(r.data))
        .catch(() => showToast('Failed to fetch student semester quota', 'error'))
        .finally(() => setLoadingQuota(false));
    }
  }, [approveTarget]);

  // Individual Actions
  const handleApprove = async () => {
    setApproving(true);
    try {
      const res = await api.post(`/admin/exit-passes/${approveTarget.id}/approve`, { adminRemark });
      setApprovedOtp(res.data.otp || '');
      showToast('Exit pass approved successfully');
      setAdminRemark('');
      load();
    } catch (err) { 
      showToast(err.response?.data?.error || 'Failed to approve exit pass', 'error'); 
      setApproveTarget(null); 
    } finally { 
      setApproving(false); 
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    setRejecting(true);
    try {
      await api.post(`/admin/exit-passes/${rejectTarget.id}/reject`, { reason: rejectReason, adminRemark: rejectReason });
      showToast('Exit pass rejected');
      setRejectTarget(null); 
      setRejectReason(''); 
      load();
    } catch (err) { 
      showToast(err.response?.data?.error || 'Failed to reject exit pass', 'error'); 
    } finally { 
      setRejecting(false); 
    }
  };

  // Group Actions
  const handleApproveGroup = async () => {
    setApprovingGroup(true);
    try {
      await api.post(`/admin/exit-passes/group/${approveGroupTarget.id}/approve`, { adminRemark });
      showToast('Group request approved atomically');
      setApproveGroupTarget(null);
      setAdminRemark('');
      loadGroups();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to approve group', 'error');
      setApproveGroupTarget(null);
    } finally {
      setApprovingGroup(false);
    }
  };

  const handleRejectGroup = async () => {
    if (!groupRejectReason.trim()) return;
    setRejectingGroup(true);
    try {
      await api.post(`/admin/exit-passes/group/${rejectGroupTarget.id}/reject`, { reason: groupRejectReason });
      showToast('Group request rejected');
      setRejectGroupTarget(null);
      setGroupRejectReason('');
      loadGroups();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to reject group', 'error');
    } finally {
      setRejectingGroup(false);
    }
  };

  // Manual Gate OTP verification
  const handleVerifyOtp = async () => {
    if (!verifyOtp.trim()) return;
    setVerifying(true); 
    setVerifyResult(null);
    try {
      const payload = { otp: verifyOtp };
      if (verifyRoll.trim()) payload.roll = verifyRoll.trim();

      const res = await api.post('/admin/exit-passes/verify-otp', payload);
      setVerifyResult({ success: true, data: res.data });
    } catch (err) { 
      setVerifyResult({ 
        success: false, 
        message: err.response?.data?.error || 'Verification failed. Invalid code or locked pass.' 
      }); 
    } finally { 
      setVerifying(false); 
    }
  };

  const formatDateTime = (dtStr) => {
    if (!dtStr) return '—';
    return new Date(dtStr).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
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
          Gate OTP Verification (Manual Fallback)
        </h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 max-w-xs min-w-[180px]">
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Student Roll (Recommended for lockout auditing)</label>
            <input
              className="input-field h-9 text-xs"
              placeholder="E.g. 25B61A0596"
              value={verifyRoll}
              onChange={e => { setVerifyRoll(e.target.value); setVerifyResult(null); }}
            />
          </div>
          <div className="flex-1 max-w-xs min-w-[180px]">
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">6-digit OTP Code</label>
            <input
              className="input-field h-9 text-center font-mono tracking-[0.2em]"
              placeholder="000000"
              value={verifyOtp}
              onChange={e => { setVerifyOtp(e.target.value); setVerifyResult(null); }}
              maxLength={8}
            />
          </div>
          <button onClick={handleVerifyOtp} className="btn-primary h-9" disabled={verifying || !verifyOtp.trim()}>
            {verifying
              ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <span className="material-symbols-outlined text-[17px]">verified_user</span>}
            Verify
          </button>
          
          {verifyResult && (
            <div className={`flex items-start gap-2 px-3 py-2 rounded-lg text-sm border max-w-md ${verifyResult.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
              <span className="material-symbols-outlined text-[18px]">{verifyResult.success ? 'check_circle' : 'cancel'}</span>
              <div>
                {verifyResult.success ? (
                  <>
                    <p className="font-semibold text-xs">Valid OTP ✓ ({verifyResult.data.status})</p>
                    {verifyResult.data?.student && <p className="text-[11px] mt-0.5">{verifyResult.data.student.name} • {verifyResult.data.student.roll}</p>}
                    {verifyResult.data?.destination && <p className="text-[11px]">To: {verifyResult.data.destination}</p>}
                    {verifyResult.data?.exitTime && <p className="text-[10px] text-gray-500 font-mono">Exit: {formatDateTime(verifyResult.data.exitTime)}</p>}
                    {verifyResult.data?.returnTime && <p className="text-[10px] text-gray-500 font-mono">Return: {formatDateTime(verifyResult.data.returnTime)}</p>}
                  </>
                ) : <p className="text-xs">{verifyResult.message}</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Workflow Switch Tabs */}
      <div className="flex gap-2 border-b border-gray-200 pb-2">
        <button
          onClick={() => { setActiveMainTab('INDIVIDUAL'); setActiveTab('ALL'); }}
          className={`px-4 py-2 text-sm font-bold border-b-2 transition-all ${activeMainTab === 'INDIVIDUAL' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
        >
          Individual Requests
        </button>
        <button
          onClick={() => { setActiveMainTab('GROUP'); setActiveTab('ALL'); }}
          className={`px-4 py-2 text-sm font-bold border-b-2 transition-all ${activeMainTab === 'GROUP' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
        >
          Group Requests
        </button>
      </div>

      <PageHeader
        title={activeMainTab === 'INDIVIDUAL' ? 'Individual Exit Passes' : 'Group Exit Requests'}
        subtitle={activeMainTab === 'INDIVIDUAL' ? `${items.length} passes found` : `${groupItems.length} groups found`}
        actions={
          <>
            {activeMainTab === 'INDIVIDUAL' && (
              <SearchInput value={search} onChange={setSearch} placeholder="Search roll, name or destination…" />
            )}
            <button onClick={activeMainTab === 'INDIVIDUAL' ? load : loadGroups} className="btn-secondary h-9">
              <span className="material-symbols-outlined text-[17px]">refresh</span>
              Refresh
            </button>
          </>
        }
      />

      {/* Status Filter Tabs */}
      <div className="flex flex-wrap gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {STATUS_TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all ${activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {tab}
          </button>
        ))}
      </div>

      {/* INDIVIDUAL REQUESTS TABLE */}
      {activeMainTab === 'INDIVIDUAL' && (
        <div className="card overflow-hidden">
          {loading ? (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="th">Student</th>
                    <th className="th">Reason & Remarks</th>
                    <th className="th">Destination & Contact</th>
                    <th className="th">Timings</th>
                    <th className="th">Status</th>
                    <th className="th text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <SkeletonRows cols={6} />
                </tbody>
              </table>
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon="exit_to_app" title="No matching individual passes" description={activeTab === 'PENDING' ? 'All pending requests reviewed.' : undefined} />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="th">Student</th>
                    <th className="th">Reason & Remarks</th>
                    <th className="th">Destination & Contact</th>
                    <th className="th">Timings</th>
                    <th className="th">Status</th>
                    <th className="th text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id} className="tr-hover align-top">
                      <td className="td">
                        <div className="flex gap-3">
                          {item.student?.photoUrl ? (
                            <img src={item.student.photoUrl} alt="Avatar" className="w-10 h-10 object-cover rounded-lg border" />
                          ) : (
                            <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center border text-gray-400 font-bold text-xs uppercase">
                              {item.student?.name?.slice(0, 2) || 'ST'}
                            </div>
                          )}
                          <div>
                            <p className="font-semibold text-gray-900 text-sm">{item.student?.name || '—'}</p>
                            <p className="text-xs text-gray-400 font-mono">{item.student?.roll || item.student?.userId}</p>
                            {item.student && (
                              <p className="text-[10px] text-gray-500 font-medium">
                                {item.student.branch} • Yr {item.student.year} ({item.student.section || 'A'})
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="td space-y-1 max-w-[200px]">
                        <p className="text-xs text-gray-700 font-semibold">{item.reason}</p>
                        {item.remarks && <p className="text-[11px] text-gray-400 leading-normal">Remarks: "{item.remarks}"</p>}
                        {item.groupRequest && (
                          <p className="text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-100 inline-block font-semibold">
                            Group: {item.groupRequest.groupName}
                          </p>
                        )}
                        {item.adminRemark && (
                          <p className="text-[10px] text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 inline-block">
                            Admin: {item.adminRemark}
                          </p>
                        )}
                        {item.identityMismatchReason && (
                          <p className="text-[10px] text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-100 block">
                            Audit Alert: {item.identityMismatchReason}
                          </p>
                        )}
                      </td>
                      <td className="td space-y-1">
                        <p className="text-sm text-gray-700 font-medium">{item.destination}</p>
                        <p className="text-xs text-gray-400 font-mono">Emergency: {item.emergencyContact || '—'}</p>
                      </td>
                      <td className="td space-y-0.5 text-xs text-gray-600 font-medium whitespace-nowrap">
                        <div className="flex gap-1 items-center"><span className="text-[10px] uppercase text-gray-400 font-bold">Out:</span> {formatDateTime(item.exitTime)}</div>
                        <div className="flex gap-1 items-center"><span className="text-[10px] uppercase text-gray-400 font-bold">In:</span> {formatDateTime(item.returnTime)}</div>
                        {item.exitConfirmedAt && (
                          <div className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1 mt-1">
                            <span className="material-symbols-outlined text-[12px]">logout</span>
                            Exited: {formatDateTime(item.exitConfirmedAt)}
                          </div>
                        )}
                      </td>
                      <td className="td"><Badge value={item.status} /></td>
                      <td className="td">
                        <div className="flex items-center gap-1.5 justify-end">
                          {item.status === 'PENDING' && !item.groupRequestId && (
                            <>
                              <button onClick={() => { setApproveTarget(item); setApprovedOtp(''); setAdminRemark(''); }} className="text-xs px-2.5 py-1 rounded-md bg-green-50 hover:bg-green-100 text-green-700 font-semibold transition-colors">Approve</button>
                              <button onClick={() => { setRejectTarget(item); setRejectReason(''); }} className="text-xs px-2.5 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-600 font-semibold transition-colors">Reject</button>
                            </>
                          )}
                          {item.status === 'PENDING' && item.groupRequestId && (
                            <span className="text-[10px] text-amber-600 font-bold uppercase">Pending Group Action</span>
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
      )}

      {/* GROUP REQUESTS TABLE */}
      {activeMainTab === 'GROUP' && (
        <div className="card overflow-hidden">
          {loadingGroups ? (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="th">Group Detail</th>
                    <th className="th">Reason</th>
                    <th className="th">Members Count & List</th>
                    <th className="th">Timings</th>
                    <th className="th">Status</th>
                    <th className="th text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <SkeletonRows cols={6} />
                </tbody>
              </table>
            </div>
          ) : groupItems.length === 0 ? (
            <EmptyState icon="groups" title="No matching group requests" description={activeTab === 'PENDING' ? 'All pending group requests reviewed.' : undefined} />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="th">Group Detail</th>
                    <th className="th">Reason</th>
                    <th className="th">Members Count & List</th>
                    <th className="th">Timings</th>
                    <th className="th">Status</th>
                    <th className="th text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {groupItems.map(group => (
                    <tr key={group.id} className="tr-hover align-top">
                      <td className="td">
                        <p className="font-bold text-gray-900 text-sm">{group.groupName}</p>
                        <p className="text-[10px] text-gray-400">ID: {group.id.slice(0, 8)}...</p>
                        <p className="text-xs text-gray-500 mt-1">To: <span className="font-semibold">{group.destination}</span></p>
                      </td>
                      <td className="td max-w-[200px]">
                        <p className="text-xs text-gray-700 leading-normal italic font-medium">"{group.reason}"</p>
                        {group.rejectionNote && <p className="text-[10px] text-red-600 mt-1">Note: {group.rejectionNote}</p>}
                      </td>
                      <td className="td space-y-1">
                        <span className="px-2 py-0.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 font-bold text-[10px]">
                          {group.passes?.length || 0} Members
                        </span>
                        
                        {/* Member Details list */}
                        <div className="max-h-24 overflow-y-auto space-y-1 mt-1.5 pr-2 custom-scrollbar">
                          {group.passes?.map(p => (
                            <div key={p.id} className="text-[11px] text-gray-600 bg-gray-50 px-2 py-1 rounded border border-gray-100 flex justify-between">
                              <span>{p.student?.name} ({p.student?.roll})</span>
                              {p.status !== 'PENDING' && <span className="font-bold uppercase text-[9px] text-gray-400">{p.status}</span>}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="td text-xs text-gray-600 font-medium space-y-0.5 whitespace-nowrap">
                        <div><span className="text-[10px] uppercase text-gray-400 font-bold">Out:</span> {formatDateTime(group.exitTime)}</div>
                        <div><span className="text-[10px] uppercase text-gray-400 font-bold">In:</span> {formatDateTime(group.returnTime)}</div>
                        <div className="text-[9px] text-gray-400 font-mono mt-1">Applied: {new Date(group.createdAt).toLocaleDateString()}</div>
                      </td>
                      <td className="td"><Badge value={group.status} /></td>
                      <td className="td">
                        <div className="flex items-center gap-1.5 justify-end">
                          {group.status === 'PENDING' && (
                            <>
                              <button onClick={() => { setApproveGroupTarget(group); setAdminRemark(''); }} className="text-xs px-2.5 py-1 rounded-md bg-green-50 hover:bg-green-100 text-green-700 font-semibold transition-colors">Approve Group</button>
                              <button onClick={() => { setRejectGroupTarget(group); setGroupRejectReason(''); }} className="text-xs px-2.5 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-600 font-semibold transition-colors">Reject Group</button>
                            </>
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
      )}

      {/* ── MODALS ── */}

      {/* Individual Approve Modal */}
      <Modal isOpen={!!approveTarget && !approvedOtp} onClose={() => setApproveTarget(null)} title="Approve Exit Pass" size="sm">
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-2">
            <div>
              <p className="text-sm font-bold text-blue-900">{approveTarget?.student?.name}</p>
              <p className="text-xs text-blue-600 font-mono">{approveTarget?.student?.roll}</p>
            </div>
            <div className="text-xs text-blue-700 border-t border-blue-100 pt-2 space-y-1">
              <p>Destination: <span className="font-semibold">{approveTarget?.destination}</span></p>
              <p>Reason: <span className="font-semibold">{approveTarget?.reason}</span></p>
            </div>
          </div>

          {/* Quota Check Alert */}
          {loadingQuota ? (
            <div className="p-3 bg-gray-50 rounded-xl border text-xs text-gray-500 animate-pulse">
              Verifying student semester quota limits...
            </div>
          ) : studentQuota ? (
            <div className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
              studentQuota.remaining <= 0 ? 'bg-red-50 border-red-200 text-red-800' : 'bg-blue-50 border-blue-200 text-blue-800'
            }`}>
              <span>Semester Quota: <strong>{studentQuota.count} / 10 Approved</strong></span>
              <span>Remaining: <strong>{studentQuota.remaining}</strong></span>
            </div>
          ) : null}

          {studentQuota && studentQuota.remaining <= 0 && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex gap-2 items-start font-medium">
              <span className="material-symbols-outlined text-sm mt-0.5">warning</span>
              <span>This student has reached their maximum quota of 10 approved passes for the current semester. Approval will fail.</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Optional Admin Remarks</label>
            <input 
              className="input-field" 
              placeholder="E.g. Approved for weekend visit" 
              value={adminRemark} 
              onChange={e => setAdminRemark(e.target.value)} 
            />
          </div>
          <p className="text-xs text-gray-500">Approving will generate a secure QR token & OTP for the student.</p>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setApproveTarget(null)} className="btn-secondary">Cancel</button>
            <button 
              onClick={handleApprove} 
              className="btn-success flex items-center gap-2" 
              disabled={approving || (studentQuota && studentQuota.remaining <= 0)}
            >
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
            <p className="text-xs text-gray-400 mt-3">Valid for 24 hours — student can scan QR code to check out.</p>
          </div>
          <button onClick={() => { setApproveTarget(null); setApprovedOtp(''); }} className="btn-primary w-full">Done</button>
        </div>
      </Modal>

      {/* Individual Reject Modal */}
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

      {/* Group Approve Confirmation Modal */}
      <Modal isOpen={!!approveGroupTarget} onClose={() => setApproveGroupTarget(null)} title="Approve Group Exit Pass Request" size="sm">
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <p className="text-sm font-bold text-blue-900">{approveGroupTarget?.groupName}</p>
            <p className="text-xs text-blue-700 mt-2">Members: <span className="font-semibold">{approveGroupTarget?.passes?.length} students</span></p>
            <p className="text-xs text-blue-700">Destination: <span className="font-semibold">{approveGroupTarget?.destination}</span></p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Optional Remarks for Group</label>
            <input 
              className="input-field" 
              placeholder="E.g. Approved for sports team event" 
              value={adminRemark} 
              onChange={e => setAdminRemark(e.target.value)} 
            />
          </div>
          <p className="text-xs text-red-600 font-semibold">
            Warning: The system will atomically verify the remaining quota of all group members. If any member has exceeded their 10 approved passes, the group approval will be rejected.
          </p>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setApproveGroupTarget(null)} className="btn-secondary">Cancel</button>
            <button onClick={handleApproveGroup} className="btn-success flex items-center gap-2" disabled={approvingGroup}>
              {approvingGroup && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {approvingGroup ? 'Approving Group…' : 'Approve Group (Atomic)'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Group Reject Modal */}
      <Modal isOpen={!!rejectGroupTarget} onClose={() => setRejectGroupTarget(null)} title="Reject Group Exit Request" size="sm">
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-100 rounded-xl p-4">
            <p className="text-sm font-bold text-red-900">{rejectGroupTarget?.groupName}</p>
            <p className="text-xs text-red-700 mt-2">Destination: {rejectGroupTarget?.destination}</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Reason for Group Rejection *</label>
            <textarea className="input-field h-24 resize-none" placeholder="Provide a reason for group rejection…" value={groupRejectReason} onChange={e => setGroupRejectReason(e.target.value)} autoFocus />
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setRejectGroupTarget(null)} className="btn-secondary">Cancel</button>
            <button onClick={handleRejectGroup} className="btn-danger flex items-center gap-2" disabled={rejectingGroup || !groupRejectReason.trim()}>
              {rejectingGroup && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {rejectingGroup ? 'Rejecting Group…' : 'Reject Entire Group'}
            </button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
