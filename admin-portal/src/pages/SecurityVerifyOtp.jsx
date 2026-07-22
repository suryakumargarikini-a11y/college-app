import React, { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import api from '../lib/api';

// Security Gate Exit Verification — QR Scan only.
// OTP-based verification has been permanently removed.
export default function SecurityVerifyOtp() {
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [passData, setPassData] = useState(null);
  const [forbiddenMsg, setForbiddenMsg] = useState('');
  const [alreadyExited, setAlreadyExited] = useState(false);
  const [showMismatchModal, setShowMismatchModal] = useState(false);
  const [mismatchReason, setMismatchReason] = useState('');
  const [reportingMismatch, setReportingMismatch] = useState(false);
  const scannerRef = useRef(null);

  // Initialize QR scanner when no pass is loaded
  useEffect(() => {
    if (passData) return;

    const delay = setTimeout(() => {
      try {
        const scanner = new Html5QrcodeScanner(
          'qr-reader',
          {
            fps: 10,
            qrbox: { width: 260, height: 260 },
            rememberLastUsedCamera: true
          },
          /* verbose= */ false
        );

        scanner.render(
          async (decodedText) => {
            setError('');
            setLoading(true);
            try {
              const res = await api.post('/admin/exit-passes/verify-qr', { token: decodedText });
              if (res.data.valid) {
                setPassData({ ...res.data, method: 'QR_SCAN' });
                scanner.clear().catch(err => console.warn('Scanner clear failed:', err));
              } else if (res.data.alreadyUsed) {
                // Already consumed — show prominent error
                setError(res.data.error || 'QR ALREADY USED — This code has already been scanned.');
              } else {
                setError(res.data.error || 'Invalid QR Code. This pass cannot be verified.');
              }
            } catch (err) {
              const errMsg = err.response?.data?.error || 'QR Verification failed. Token is invalid, expired, or already used.';
              setError(errMsg);
            } finally {
              setLoading(false);
            }
          },
          () => {
            // Continuous scan errors are expected when no QR is visible — ignore
          }
        );

        scannerRef.current = scanner;
      } catch (e) {
        console.error('Failed to initialize QR scanner:', e);
      }
    }, 200);

    return () => {
      clearTimeout(delay);
      if (scannerRef.current) {
        scannerRef.current.clear().catch(err => console.warn('Scanner cleanup failed:', err));
        scannerRef.current = null;
      }
    };
  }, [passData]);

  const handleReset = () => {
    setPassData(null);
    setError('');
    setSuccessMsg('');
    setMismatchReason('');
    setShowMismatchModal(false);
    setForbiddenMsg('');
    setAlreadyExited(false);
  };

  const handleConfirmExit = async () => {
    if (!passData) return;
    setVerifying(true);
    setError('');
    setSuccessMsg('');
    setForbiddenMsg('');
    setAlreadyExited(false);

    try {
      const res = await api.post(`/admin/exit-passes/${passData.id}/confirm-exit`, {
        gate: 'MAIN_GATE',
        verificationMethod: 'QR_SCAN'
      });

      if (res.data.success && res.data.state === 'EXITED') {
        setSuccessMsg('Exit confirmed successfully! Parent notification sent.');
        setTimeout(() => handleReset(), 2500);
      } else if (res.data.state === 'ALREADY_EXITED') {
        setAlreadyExited(true);
      } else {
        setError(res.data.error || 'Failed to record exit.');
      }
    } catch (err) {
      const state = err.response?.data?.state || '';
      const errMsg = err.response?.data?.error || 'Server error confirming student exit.';
      if (state === 'FORBIDDEN' || err.response?.status === 403) {
        setForbiddenMsg(errMsg);
      } else if (state === 'ALREADY_EXITED') {
        setAlreadyExited(true);
      } else {
        setError(errMsg);
      }
    } finally {
      setVerifying(false);
    }
  };

  const handleRejectIdentity = async () => {
    if (!passData || !mismatchReason.trim()) return;
    setReportingMismatch(true);
    setError('');

    try {
      await api.post(`/admin/exit-passes/${passData.id}/reject-identity`, { reason: mismatchReason });
      setSuccessMsg('Identity mismatch reported. Exit pass suspended under review.');
      setShowMismatchModal(false);
      setTimeout(() => handleReset(), 2500);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit mismatch report.');
    } finally {
      setReportingMismatch(false);
    }
  };

  const formatDateTime = (dtStr) => {
    if (!dtStr) return '—';
    return new Date(dtStr).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-6 select-none max-w-4xl mx-auto fade-in">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Security Gate Exit Verification</h2>
        <p className="text-sm text-gray-500 mt-1">Scan student's QR code to verify their approved exit pass.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">

        {/* LEFT PANEL: QR SCANNER */}
        {!passData && (
          <section className="md:col-span-5 bg-white p-6 border border-gray-200 rounded-2xl shadow-sm space-y-4">
            <div className="space-y-3">
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">
                Scan Campus Exit QR Code
              </label>
              <div id="qr-reader" className="w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-50"></div>
            </div>

            {loading && (
              <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-100 rounded-xl p-3">
                <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0"></span>
                <span>Verifying QR code...</span>
              </div>
            )}

            {error && (
              <div className={`p-3.5 border rounded-xl text-xs flex items-start gap-2 leading-relaxed ${error.includes('ALREADY USED') ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
                <span className="material-symbols-outlined text-[16px] flex-shrink-0">{error.includes('ALREADY USED') ? 'warning' : 'error'}</span>
                <span>{error}</span>
              </div>
            )}

            <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl">
              <h4 className="text-xs font-bold text-blue-800 mb-1 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm font-semibold">info</span>
                Gate Security Rules
              </h4>
              <ul className="text-[11px] text-blue-700/80 space-y-1 pl-4 list-disc leading-relaxed">
                <li>Only approved, unexpired QR codes will verify successfully.</li>
                <li>Each QR code is single-use — a second scan will be rejected.</li>
                <li>Guard-binding: only the guard who scanned the QR may confirm that exit.</li>
                <li>Verify that the student's photo matches the person at the gate.</li>
                <li>Report identity mismatches immediately.</li>
              </ul>
            </div>
          </section>
        )}

        {/* RIGHT PANEL: VERIFIED STUDENT DETAILS */}
        <section className={`${passData ? 'col-span-12' : 'md:col-span-7'}`}>
          {passData ? (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-md max-w-2xl mx-auto">

              {/* QR Consumed Notice */}
              <div className="bg-emerald-50 border-b border-emerald-100 px-6 py-3 flex items-center gap-2 text-emerald-800 text-xs font-bold">
                <span className="material-symbols-outlined text-emerald-600 text-[18px]">verified</span>
                QR Code Verified &amp; Consumed — Confirm exit below to complete the record.
              </div>

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
                  <span className="bg-green-100 border border-green-200 text-green-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                    Valid Pass
                  </span>
                  <span className="text-[10px] bg-gray-200 text-gray-600 px-2 py-0.5 rounded font-semibold uppercase">
                    QR Verified
                  </span>
                </div>
              </div>

              {/* Pass Details */}
              <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-6 text-sm">
                <div>
                  <span className="block text-xs font-bold text-gray-400 uppercase tracking-wide">Branch &amp; Section</span>
                  <span className="font-semibold text-gray-800 mt-0.5 block">
                    {passData.student?.branch} — Year {passData.student?.year} ({passData.student?.section || 'A'})
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
                  <span className="block text-xs font-bold text-gray-400 uppercase tracking-wide">Requested Exit</span>
                  <span className="text-gray-700 mt-0.5 block font-semibold text-xs">{formatDateTime(passData.exitTime)}</span>
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

              {/* Status Messages */}
              {(error || successMsg || forbiddenMsg || alreadyExited) && (
                <div className="px-6 py-2 space-y-2">
                  {forbiddenMsg && (
                    <div className="p-3.5 bg-amber-50 border border-amber-300 text-amber-900 rounded-xl text-xs flex items-start gap-2 font-semibold leading-relaxed">
                      <span className="material-symbols-outlined text-[18px] text-amber-600 flex-shrink-0">shield_lock</span>
                      <div>
                        <p className="font-black mb-0.5">Guard-Binding Security Error</p>
                        <p>{forbiddenMsg}</p>
                        <p className="mt-1 text-amber-700 font-normal">Ask the guard who scanned the QR to confirm this exit, or contact a SUPER_ADMIN.</p>
                      </div>
                    </div>
                  )}
                  {alreadyExited && (
                    <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 rounded-xl text-xs flex items-center gap-2 font-semibold">
                      <span className="material-symbols-outlined text-[16px]">how_to_reg</span>
                      <span>Exit already recorded. This student's exit has been confirmed by a previous request.</span>
                    </div>
                  )}
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

              {/* Action Buttons */}
              <div className="bg-gray-50 px-6 py-4 flex flex-wrap gap-3 justify-between items-center border-t border-gray-100">
                <button
                  onClick={handleReset}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-xl text-xs font-bold hover:bg-gray-100 transition-all"
                  disabled={verifying}
                >
                  Cancel / Scan Next
                </button>

                <div className="flex gap-2">
                  {!successMsg && !alreadyExited && (
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
                            <span>Confirm Exit &amp; Record</span>
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
              <h4 className="text-sm font-bold text-gray-700">Awaiting QR Scan</h4>
              <p className="text-xs text-gray-400 mt-1 max-w-xs leading-relaxed">
                Ask the student to open their Exit Pass in the SITAM app and scan the displayed QR code.
              </p>
            </div>
          )}
        </section>
      </div>

      {/* Identity Mismatch Dialog */}
      {showMismatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white border border-gray-200 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-red-600 text-[18px]">warning</span>
              Report Identity Mismatch
            </h3>
            <p className="text-xs text-gray-500">
              This action blocks the exit pass, suspends it under review, and logs a security audit event.
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
