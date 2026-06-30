import React, { useState, useEffect, useRef } from 'react';
import api from '../lib/api';

export default function SecurityVerifyOtp() {
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [passData, setPassData] = useState(null);
  const [verifiedSuccess, setVerifiedSuccess] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    // Auto focus OTP input on mount
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleVerify = async (e) => {
    if (e) e.preventDefault();
    if (otp.length !== 6) {
      setError('Please enter a 6-digit OTP code.');
      return;
    }
    setError('');
    setLoading(true);
    setPassData(null);
    setVerifiedSuccess(false);

    try {
      const res = await api.post('/admin/exit-passes/verify-otp', { otp });
      if (res.data.valid) {
        setPassData(res.data);
      } else {
        setError(res.data.error || 'Invalid OTP');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'OTP verification failed. Invalid code.');
    } finally {
      setLoading(false);
    }
  };

  const handleMarkUsed = async () => {
    if (!passData) return;
    setVerifying(true);
    setError('');

    try {
      await api.post(`/admin/exit-passes/${passData.id}/mark-used`);
      setVerifiedSuccess(true);
      
      // Auto-reload/reset form after success so the guard can verify the next pass
      setTimeout(() => {
        setOtp('');
        setPassData(null);
        setVerifiedSuccess(false);
        if (inputRef.current) inputRef.current.focus();
      }, 1500);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to mark pass as used.');
    } finally {
      setVerifying(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'APPROVED':
        return <span className="bg-green-100 border border-green-200 text-green-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">Valid</span>;
      case 'USED':
        return <span className="bg-gray-100 border border-gray-200 text-gray-600 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">Already Used</span>;
      case 'EXPIRED':
        return <span className="bg-amber-100 border border-amber-200 text-amber-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">Expired</span>;
      default:
        return <span className="bg-red-100 border border-red-200 text-red-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">{status}</span>;
    }
  };

  return (
    <div className="space-y-6 select-none max-w-4xl mx-auto fade-in">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Security Gate OTP Verification</h2>
        <p className="text-sm text-gray-500 mt-1">Verify student exit pass OTPs and mark them used at the gate.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        {/* Step 1: Input OTP Section */}
        <section className="md:col-span-5 bg-white p-6 border border-gray-200 rounded-2xl shadow-sm space-y-4">
          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2" htmlFor="otp-input">
                Enter Gate Pass OTP
              </label>
              <input
                ref={inputRef}
                className="w-full h-14 text-center text-3xl font-mono tracking-[0.5em] border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all bg-gray-50 text-gray-800"
                id="otp-input"
                maxLength={6}
                type="text"
                placeholder="000000"
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                disabled={loading || verifiedSuccess}
              />
            </div>
            
            <button
              className="w-full h-11 bg-blue-600 text-white font-semibold text-sm rounded-xl hover:bg-blue-700 hover:shadow active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              type="submit"
              disabled={loading || otp.length !== 6 || verifiedSuccess}
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-sm">verified_user</span>
                  <span>Verify OTP</span>
                </>
              )}
            </button>
          </form>

          {error && (
            <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
              <span className="material-symbols-outlined text-sm">error</span>
              <span>{error}</span>
            </div>
          )}

          <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl">
            <h4 className="text-xs font-bold text-blue-800 mb-1 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm font-semibold">info</span>
              Security Quick Tips
            </h4>
            <ul className="text-[11px] text-blue-700/80 space-y-1 pl-4 list-disc leading-relaxed">
              <li>OTPs are single-use and expire within 24 hours.</li>
              <li>Ask the student for their ID card if verification fails.</li>
              <li>Always check the student photo and roll number details.</li>
            </ul>
          </div>
        </section>

        {/* Step 2: Results Section */}
        <section className="md:col-span-7">
          {passData ? (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
              <div className="p-6 border-b border-gray-100 flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{passData.student?.name}</h3>
                  <p className="text-xs font-mono text-gray-400 mt-0.5">{passData.student?.roll}</p>
                </div>
                {getStatusBadge(passData.status)}
              </div>

              <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-6 text-sm">
                <div>
                  <span className="block text-xs font-bold text-gray-400 uppercase tracking-wide">Branch & Year</span>
                  <span className="font-semibold text-gray-800 mt-0.5 block">
                    {passData.student?.branch} - {passData.student?.year}
                  </span>
                </div>
                <div>
                  <span className="block text-xs font-bold text-gray-400 uppercase tracking-wide">Destination</span>
                  <span className="font-semibold text-gray-800 mt-0.5 block">{passData.destination}</span>
                </div>
                <div className="sm:col-span-2">
                  <span className="block text-xs font-bold text-gray-400 uppercase tracking-wide">Reason for Leave</span>
                  <span className="block p-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-600 mt-1 italic text-xs">
                    "{passData.reason}"
                  </span>
                </div>
                <div>
                  <span className="block text-xs font-bold text-gray-400 uppercase tracking-wide">Requested Date</span>
                  <span className="text-gray-700 mt-0.5 block font-medium">{passData.requestedDate}</span>
                </div>
                <div>
                  <span className="block text-xs font-bold text-gray-400 uppercase tracking-wide">Approved By</span>
                  <span className="text-gray-700 mt-0.5 block font-medium">{passData.approvedBy || 'Admin'}</span>
                </div>
              </div>

              {/* Action Area */}
              <div className="bg-gray-50 px-6 py-4 flex justify-between items-center border-t border-gray-100">
                <span className="text-xs text-gray-400 font-mono">
                  Expires: {passData.otpExpiry ? new Date(passData.otpExpiry).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                </span>
                
                {passData.status === 'APPROVED' ? (
                  <button
                    onClick={handleMarkUsed}
                    className={`px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all active:scale-[0.98] ${
                      verifiedSuccess 
                        ? 'bg-emerald-600 text-white shadow-md' 
                        : 'bg-gray-900 text-white hover:bg-black'
                    }`}
                    disabled={verifying || verifiedSuccess}
                  >
                    {verifying ? (
                      <>
                        <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                        <span>Updating...</span>
                      </>
                    ) : verifiedSuccess ? (
                      <>
                        <span className="material-symbols-outlined text-sm font-bold">check_circle</span>
                        <span>Verified Successfully</span>
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-sm">how_to_reg</span>
                        <span>Mark Pass Used</span>
                      </>
                    )}
                  </button>
                ) : (
                  <span className="text-xs font-bold text-red-600">Pass cannot be checked out</span>
                )}
              </div>
            </div>
          ) : (
            <div className="h-64 border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50/50 flex flex-col items-center justify-center text-center p-6">
              <div className="w-16 h-16 bg-white border border-gray-100 rounded-2xl flex items-center justify-center shadow-sm mb-4">
                <span className="material-symbols-outlined text-3xl text-gray-400">search_check</span>
              </div>
              <h4 className="text-sm font-bold text-gray-700">Awaiting OTP Verification</h4>
              <p className="text-xs text-gray-400 mt-1 max-w-xs">
                Enter the 6-digit security code provided by the student to check and retrieve their pass details.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
