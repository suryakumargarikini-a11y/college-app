import React, { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import api from '../lib/api';

export default function SecurityVerifyOtp() {
  // Tabs: 'SCANNER' or 'MANUAL'
  const [activeMode, setActiveMode] = useState('SCANNER');
  
  // Form input states
  const [otp, setOtp] = useState('');
  const [roll, setRoll] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  
  // Verification states
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [passData, setPassData] = useState(null);
  
  // Identity Mismatch states
  const [showMismatchModal, setShowMismatchModal] = useState(false);
  const [mismatchReason, setMismatchReason] = useState('');
  const [reportingMismatch, setReportingMismatch] = useState(false);
  
  const inputRef = useRef(null);
  const scannerRef = useRef(null);

  // Initialize html5-qrcode scanner when SCANNER tab is active
  useEffect(() => {
    if (activeMode === 'SCANNER' && !passData) {
      // Small timeout to ensure DOM container is ready
      const delay = setTimeout(() => {
        try {
          const scanner = new Html5QrcodeScanner(
            'qr-reader',
            { 
              fps: 10, 
              qrbox: { width: 250, height: 250 },
              rememberLastUsedCamera: true
            },
            /* verbose= */ false
          );

          scanner.render(
            async (decodedText) => {
              // Found a QR token
              setError('');
              setLoading(true);
              try {
                const res = await api.post('/admin/exit-passes/verify-qr', { token: decodedText });
                if (res.data.valid) {
                  setPassData({ ...res.data, method: 'QR_SCAN' });
                  scanner.clear().catch(err => console.warn('Scanner clear failed:', err));
                } else {
                  setError(res.data.error || 'Invalid QR Code');
                }
              } catch (err) {
                setError(err.response?.data?.error || 'QR Verification failed. Token is invalid or expired.');
              } finally {
                setLoading(false);
              }
            },
            (err) => {
              // Ignore scanning errors as they trigger continuously on no-detection
            }
          );

          scannerRef.current = scanner;
        } catch (e) {
          console.error('Failed to initialize Html5QrcodeScanner:', e);
        }
      }, 200);

      return () => {
        clearTimeout(delay);
        if (scannerRef.current) {
          scannerRef.current.clear().catch(err => console.warn('Scanner cleanup failed:', err));
          scannerRef.current = null;
        }
      };
    }
  }, [activeMode, passData]);

  // Focus OTP input when MANUAL tab is active
  useEffect(() => {
    if (activeMode === 'MANUAL' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [activeMode]);

  // Reset verification form and restart scanner
  const handleReset = () => {
    setOtp('');
    setRoll('');
    setPassData(null);
    setError('');
    setSuccessMsg('');
    setMismatchReason('');
    setShowMismatchModal(false);
  };

  // Manual OTP verification action
  const handleVerifyOtp = async (e) => {
    if (e) e.preventDefault();
    if (otp.length !== 6) {
      setError('Please enter a 6-digit OTP code.');
      return;
    }
    setError('');
    setLoading(true);
    setPassData(null);

    try {
      const payload = { otp };
      if (roll.trim()) payload.roll = roll.trim();

      const res = await api.post('/admin/exit-passes/verify-otp', payload);
      if (res.data.valid) {
        setPassData({ ...res.data, method: 'MANUAL_OTP' });
      } else {
        setError(res.data.error || 'Invalid OTP');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'OTP verification failed. Code is invalid or pass is locked.');
    } finally {
      setLoading(false);
    }
  };

  // Confirm student exit
  const handleConfirmExit = async () => {
    if (!passData) return;
    setVerifying(true);
    setError('');
    setSuccessMsg('');

    try {
      const gate = 'MAIN_GATE';
      const verificationMethod = passData.method || 'QR_SCAN';

      const res = await api.post(`/admin/exit-passes/${passData.id}/confirm-exit`, { 
        gate, 
        verificationMethod 
      });

      if (res.data.success) {
        setSuccessMsg('Exit confirmed successfully! Parent SMS sent.');
        // Auto-reset after a short delay
        setTimeout(() => {
          handleReset();
        }, 2000);
      } else {
        setError(res.data.error || 'Failed to record exit.');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Server error confirming student exit.');
    } finally {
      setVerifying(false);
    }
  };

  // Identity Mismatch submit
  const handleRejectIdentity = async () => {
    if (!passData || !mismatchReason.trim()) return;
    setReportingMismatch(true);
    setError('');

    try {
      await api.post(`/admin/exit-passes/${passData.id}/reject-identity`, { 
        reason: mismatchReason 
      });
      setSuccessMsg('Identity mismatch reported. Exit pass has been suspended under review.');
      setShowMismatchModal(false);
      
      setTimeout(() => {
        handleReset();
      }, 2500);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit mismatch report.');
    } finally {
      setReportingMismatch(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'APPROVED':
        return <span className="bg-green-100 border border-green-200 text-green-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">Valid</span>;
      case 'EXITED':
      case 'USED':
        return <span className="bg-gray-100 border border-gray-200 text-gray-600 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">Already Exited</span>;
      case 'EXPIRED':
        return <span className="bg-amber-100 border border-amber-200 text-amber-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">Expired</span>;
      case 'UNDER_REVIEW':
        return <span className="bg-red-100 border border-red-200 text-red-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">Suspended</span>;
      default:
        return <span className="bg-red-100 border border-red-200 text-red-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">{status}</span>;
    }
  };

  return (
    <div className="space-y-6 select-none max-w-4xl mx-auto fade-in">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Security Gate Exit Verification</h2>
        <p className="text-sm text-gray-500 mt-1">Verify student exit passes using camera QR scanner or manual OTP lookup.</p>
      </div>

      {/* Mode Selector Tabs */}
      {!passData && (
        <div className="flex gap-2 bg-gray-100 p-1 rounded-xl w-fit">
          <button
            onClick={() => { setActiveMode('SCANNER'); setError(''); }}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${activeMode === 'SCANNER' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <span className="material-symbols-outlined text-[16px]">qr_code_scanner</span>
            QR Camera Scanner
          </button>
          <button
            onClick={() => { setActiveMode('MANUAL'); setError(''); }}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${activeMode === 'MANUAL' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <span className="material-symbols-outlined text-[16px]">pin</span>
            Manual OTP Lookup
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        
        {/* LEFT PANEL: SCANNING OR FORM ENTRY */}
        {!passData && (
          <section className="md:col-span-5 bg-white p-6 border border-gray-200 rounded-2xl shadow-sm space-y-4">
            
            {activeMode === 'SCANNER' && (
              <div className="space-y-3">
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">
                  Scan Campus Exit QR Code
                </label>
                <div id="qr-reader" className="w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-50"></div>
              </div>
            )}

            {activeMode === 'MANUAL' && (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2" htmlFor="roll-input">
                    Student Roll Number (Optional but recommended)
                  </label>
                  <input
                    className="w-full h-11 px-4 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all bg-gray-50 text-sm font-semibold"
                    id="roll-input"
                    placeholder="E.g. 25B61A0596"
                    value={roll}
                    onChange={e => setRoll(e.target.value.toUpperCase())}
                    disabled={loading}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2" htmlFor="otp-input">
                    Enter Gate Pass OTP
                  </label>
                  <input
                    ref={inputRef}
                    className="w-full h-12 text-center text-2xl font-mono tracking-[0.4em] border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all bg-gray-50 text-gray-800"
                    id="otp-input"
                    maxLength={6}
                    type="text"
                    placeholder="000000"
                    value={otp}
                    onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                    disabled={loading}
                  />
                </div>
                
                <button
                  className="w-full h-11 bg-blue-600 text-white font-semibold text-sm rounded-xl hover:bg-blue-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                  type="submit"
                  disabled={loading || otp.length !== 6}
                >
                  {loading ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[18px]">verified_user</span>
                      <span>Verify Code</span>
                    </>
                  )}
                </button>
              </form>
            )}

            {error && (
              <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2 leading-relaxed">
                <span className="material-symbols-outlined text-[16px] flex-shrink-0">error</span>
                <span>{error}</span>
              </div>
            )}

            <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl">
              <h4 className="text-xs font-bold text-blue-800 mb-1 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm font-semibold">info</span>
                Gate Audit Rules
              </h4>
              <ul className="text-[11px] text-blue-700/80 space-y-1 pl-4 list-disc leading-relaxed">
                <li>Failed manual OTP inputs count towards pass locks.</li>
                <li>Verify student photo matches the person at the gate.</li>
                <li>Suspected mismatches can be reported immediately.</li>
              </ul>
            </div>
          </section>
        )}

        {/* RIGHT PANEL: DETAILS & ACTIONS */}
        <section className={`${passData ? 'col-span-12' : 'md:col-span-7'}`}>
          {passData ? (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-md max-w-2xl mx-auto">
              
              {/* Profile Card Header */}
              <div className="p-6 border-b border-gray-100 flex gap-4 items-center bg-gray-50/50">
                {passData.student?.photoUrl ? (
                  <img 
                    src={passData.student.photoUrl} 
                    alt="Student Card Profile" 
                    className="w-16 h-16 object-cover rounded-xl border border-gray-200" 
                  />
                ) : (
                  <div className="w-16 h-16 bg-blue-50 rounded-xl flex items-center justify-center border border-blue-100 text-blue-600 font-bold text-xl uppercase">
                    {passData.student?.name?.slice(0, 2) || 'ST'}
                  </div>
                )}
                
                <div className="flex-1 min-w-0">
                  <h3 className="text-xl font-bold text-gray-900 truncate">{passData.student?.name}</h3>
                  <p className="text-sm font-mono text-gray-400 mt-0.5">{passData.student?.roll}</p>
                </div>
                
                <div className="flex flex-col items-end gap-1.5">
                  {getStatusBadge(passData.status)}
                  <span className="text-[10px] bg-gray-200 text-gray-600 px-2 py-0.5 rounded font-semibold uppercase">
                    Verified via {passData.method === 'QR_SCAN' ? 'QR Code' : 'OTP'}
                  </span>
                </div>
              </div>

              {/* Leave details */}
              <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-6 text-sm">
                <div>
                  <span className="block text-xs font-bold text-gray-400 uppercase tracking-wide">Branch & Section</span>
                  <span className="font-semibold text-gray-800 mt-0.5 block">
                    {passData.student?.branch} - Year {passData.student?.year} ({passData.student?.section || 'A'})
                  </span>
                </div>
                <div>
                  <span className="block text-xs font-bold text-gray-400 uppercase tracking-wide">Destination</span>
                  <span className="font-semibold text-gray-800 mt-0.5 block truncate">{passData.destination}</span>
                </div>
                <div className="sm:col-span-2">
                  <span className="block text-xs font-bold text-gray-400 uppercase tracking-wide">Reason for Leave</span>
                  <span className="block p-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-600 mt-1 italic text-xs">
                    "{passData.reason}"
                  </span>
                </div>
                <div>
                  <span className="block text-xs font-bold text-gray-400 uppercase tracking-wide">Leave Timings</span>
                  <span className="text-gray-700 mt-0.5 block font-semibold text-xs space-y-0.5">
                    <div>Out: {formatDateTime(passData.exitTime)}</div>
                    <div>In: {formatDateTime(passData.returnTime)}</div>
                  </span>
                </div>
                <div>
                  <span className="block text-xs font-bold text-gray-400 uppercase tracking-wide">Emergency Contact</span>
                  <span className="text-gray-700 mt-0.5 block font-mono font-medium">{passData.emergencyContact || 'N/A'}</span>
                </div>
                
                {passData.remarks && (
                  <div className="sm:col-span-2">
                    <span className="block text-xs font-bold text-gray-400 uppercase tracking-wide">Student Remarks</span>
                    <p className="text-xs text-gray-500 mt-0.5">{passData.remarks}</p>
                  </div>
                )}

                {passData.adminRemark && (
                  <div className="sm:col-span-2">
                    <span className="block text-xs font-bold text-gray-400 uppercase tracking-wide">Admin Remarks</span>
                    <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 p-2 rounded-lg mt-0.5">{passData.adminRemark}</p>
                  </div>
                )}
              </div>

              {/* Status notifications inside Card */}
              {(error || successMsg) && (
                <div className="px-6 py-2">
                  {error && (
                    <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                      <span className="material-symbols-outlined text-[16px]">error</span>
                      <span>{error}</span>
                    </div>
                  )}
                  {successMsg && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2 font-semibold">
                      <span className="material-symbols-outlined text-[16px]">check_circle</span>
                      <span>{successMsg}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Action buttons footer */}
              <div className="bg-gray-50 px-6 py-4 flex flex-wrap gap-3 justify-between items-center border-t border-gray-100">
                <button
                  onClick={handleReset}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-xl text-xs font-bold hover:bg-gray-100 transition-all"
                  disabled={verifying}
                >
                  Cancel / Scan Next
                </button>
                
                <div className="flex gap-2">
                  {passData.status === 'APPROVED' && !successMsg && (
                    <>
                      <button
                        onClick={() => setShowMismatchModal(true)}
                        className="px-4 py-2 bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 rounded-xl text-xs font-bold flex items-center gap-1 transition-all"
                        disabled={verifying}
                      >
                        <span className="material-symbols-outlined text-[14px]">warning</span>
                        Identity Mismatch
                      </button>
                      <button
                        onClick={handleConfirmExit}
                        className="px-5 py-2 bg-gray-900 text-white hover:bg-black rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow active:scale-[0.98]"
                        disabled={verifying}
                      >
                        {verifying ? (
                          <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                        ) : (
                          <>
                            <span className="material-symbols-outlined text-[15px]">how_to_reg</span>
                            <span>Confirm Exit & Record</span>
                          </>
                        )}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-72 border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50/50 flex flex-col items-center justify-center text-center p-6">
              <div className="w-16 h-16 bg-white border border-gray-100 rounded-2xl flex items-center justify-center shadow-sm mb-4">
                <span className="material-symbols-outlined text-3xl text-gray-400">qr_code_scanner</span>
              </div>
              <h4 className="text-sm font-bold text-gray-700">Awaiting Exit Pass Scan</h4>
              <p className="text-xs text-gray-400 mt-1 max-w-xs leading-relaxed">
                Scan the QR code on the student's mobile screen or lookup their 6-digit OTP code manually to verify access.
              </p>
            </div>
          )}
        </section>
      </div>

      {/* Identity Mismatch Reason Dialog */}
      {showMismatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white border border-gray-200 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-red-600 text-[18px]">warning</span>
              Report Identity Mismatch
            </h3>
            <p className="text-xs text-gray-500">
              This action blocks the exit pass, suspends it under review, and logs a warning audit event. Specify the reason below.
            </p>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Mismatch details / Observation *</label>
              <textarea
                className="w-full h-24 border border-gray-200 rounded-xl p-3 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-500/10 text-xs resize-none"
                placeholder="E.g. Profile photo does not match student at the gate; wrong roll number"
                value={mismatchReason}
                onChange={e => setMismatchReason(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button 
                onClick={() => setShowMismatchModal(false)} 
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-semibold text-gray-500 hover:bg-gray-100"
                disabled={reportingMismatch}
              >
                Cancel
              </button>
              <button 
                onClick={handleRejectIdentity}
                className="px-3.5 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 flex items-center gap-1"
                disabled={reportingMismatch || !mismatchReason.trim()}
              >
                {reportingMismatch && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>}
                Confirm Mismatch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
