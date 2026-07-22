import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import api from '../lib/api';

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

  // Camera scanner states
  const [isScanning, setIsScanning] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const processingRef = useRef(false);
  const lastFailLogRef = useRef(0);

  // Stop camera and release all MediaStream tracks
  const stopCamera = async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        await html5QrCodeRef.current.clear();
      } catch (err) {
        console.warn('Camera stop cleanup error:', err);
      } finally {
        html5QrCodeRef.current = null;
        setIsScanning(false);
      }
    }
  };

  // Start Rear Camera Scanning
  const startCamera = async () => {
    setCameraError('');
    setError('');
    processingRef.current = false;

    // Check secure context / mediaDevices support
    if (typeof window !== 'undefined' && !window.isSecureContext && window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setCameraError('Camera access requires a secure HTTPS connection. Please use HTTPS or use the image upload option below.');
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Camera access is not supported by this browser. Please use the image upload fallback.');
      return;
    }

    await stopCamera();

    try {
      console.log('[QR-SCAN] scanner creating...');
      const html5QrCode = new Html5Qrcode('qr-reader');
      html5QrCodeRef.current = html5QrCode;
      console.log('[QR-SCAN] scanner created');

      // 1. Enumerate cameras to find exact device ID (preferred method for Android Chrome)
      let cameraConfig = { facingMode: 'environment' };

      try {
        const cameras = await Html5Qrcode.getCameras();
        if (cameras && cameras.length > 0) {
          const rearCam = cameras.find(c => {
            const label = (c.label || '').toLowerCase();
            return label.includes('back') || label.includes('rear') || label.includes('environment') || label.includes('facing back');
          });
          const selectedCam = rearCam || (cameras.length > 1 ? cameras[cameras.length - 1] : cameras[0]);
          if (selectedCam && selectedCam.id) {
            cameraConfig = selectedCam.id;
            console.log('[QR-SCAN] selected camera device ID:', selectedCam.id, 'label:', selectedCam.label);
          }
        }
      } catch (e) {
        console.warn('[QR-SCAN] camera enumeration fallback to facingMode string:', e);
      }

      const scanConfig = {
        fps: 10,
        qrbox: { width: 250, height: 250 }
      };

      const handleScanSuccess = (decodedText, decodedResult) => {
        if (processingRef.current) return;
        processingRef.current = true;

        const textLen = decodedText ? decodedText.length : 0;
        console.log(`[QR-SCAN] QR detected — decoded text length=${textLen}`);
        console.log('[QR-SCAN] success callback entered');

        if (decodedText && decodedText.startsWith('SITAM-QR-TEST')) {
          console.log('[QR-SCAN] Dummy test QR detected successfully!');
          setSuccessMsg(`✓ Test QR Code Detected (Length: ${textLen}) — Camera scanner is working cleanly!`);
          setTimeout(() => {
            setSuccessMsg('');
            processingRef.current = false;
          }, 3500);
          return;
        }

        // Real QR token: safely stop camera in background and trigger backend verification
        setTimeout(() => {
          stopCamera().catch(err => console.warn('Background stopCamera error:', err));
        }, 100);

        verifyToken(decodedText);
      };

      const handleScanFailure = (errStr) => {
        const now = Date.now();
        if (now - lastFailLogRef.current > 2000) {
          lastFailLogRef.current = now;
          console.log('[QR-SCAN] scan loop active (fps=10) — searching for QR frame...');
        }
      };

      try {
        console.log('[QR-SCAN] starting camera with config:', cameraConfig);
        await html5QrCode.start(
          cameraConfig,
          scanConfig,
          handleScanSuccess,
          handleScanFailure
        );
        console.log('[QR-SCAN] camera started successfully! scanner state isScanning=true');
      } catch (startErr) {
        if (typeof cameraConfig !== 'string' || cameraConfig !== 'environment') {
          console.warn('[QR-SCAN] First camera config failed, retrying with facingMode: "environment"', startErr);
          await html5QrCode.start(
            { facingMode: 'environment' },
            scanConfig,
            handleScanSuccess,
            handleScanFailure
          );
          console.log('[QR-SCAN] camera started with facingMode fallback!');
        } else {
          throw startErr;
        }
      }

      setIsScanning(true);
    } catch (err) {
      console.error('[QR-SCAN] Camera initialization failed:', err);
      const errName = err?.name || '';
      const errMsg = err?.message || String(err);

      if (errName === 'NotAllowedError' || errMsg.includes('Permission denied')) {
        setCameraError('Camera permission is blocked. Enable camera access for this site in your browser settings.');
      } else if (errName === 'NotFoundError' || errMsg.includes('Requested device not found')) {
        setCameraError('No camera found on this device.');
      } else if (errName === 'NotReadableError' || errMsg.includes('Could not start video source')) {
        setCameraError('Camera is currently in use by another app or inaccessible.');
      } else if (errMsg.includes('facingMode')) {
        setCameraError(`Camera constraint error: ${errMsg}`);
      } else {
        setCameraError(`Camera error: ${errMsg || 'Unable to access camera'}`);
      }
      setIsScanning(false);
      processingRef.current = false;
    }
  };

  // Verify Opaque QR Token with Backend
  const verifyToken = async (rawToken) => {
    if (!rawToken || !rawToken.trim()) {
      processingRef.current = false;
      return;
    }
    setError('');
    setLoading(true);
    console.log(`[QR-SCAN] verification request starting — token length=${rawToken.trim().length}`);

    try {
      const res = await api.post('/admin/exit-passes/verify-qr', { token: rawToken.trim() });
      console.log('[QR-SCAN] verification response status=', res.status, 'valid=', res.data.valid, 'alreadyUsed=', res.data.alreadyUsed);
      if (res.data.valid) {
        setPassData({ ...res.data, method: 'QR_SCAN' });
      } else if (res.data.alreadyUsed) {
        setError(res.data.error || 'QR ALREADY USED — This code has already been scanned.');
        processingRef.current = false;
      } else {
        setError(res.data.error || 'Invalid Exit Pass. Token is invalid or expired.');
        processingRef.current = false;
      }
    } catch (err) {
      const status = err.response?.status || 500;
      const errMsg = err.response?.data?.error || 'QR Verification failed. Token is invalid, expired, or already used.';
      console.log('[QR-SCAN] verification response status=', status, 'error=', errMsg);
      setError(errMsg);
      processingRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  // Handle File Upload Fallback
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    await stopCamera();
    setUploadingImage(true);
    setError('');

    try {
      const html5QrCode = new Html5Qrcode('qr-reader-temp');
      const decodedText = await html5QrCode.scanFile(file, true);
      await html5QrCode.clear();
      verifyToken(decodedText);
    } catch (err) {
      setError('Could not decode QR code from the uploaded image. Please ensure the QR is clearly visible.');
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Auto-start camera when scanner UI is visible (and no pass is verified yet)
  useEffect(() => {
    if (!passData && !showFileUpload) {
      const timer = setTimeout(() => {
        startCamera();
      }, 300);
      return () => {
        clearTimeout(timer);
        stopCamera();
      };
    }
    return () => {
      stopCamera();
    };
  }, [passData, showFileUpload]);

  const handleReset = async () => {
    setPassData(null);
    setError('');
    setSuccessMsg('');
    setMismatchReason('');
    setShowMismatchModal(false);
    setForbiddenMsg('');
    setAlreadyExited(false);
    setShowFileUpload(false);
    startCamera();
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
    <div className="w-full max-w-2xl mx-auto space-y-5 select-none fade-in px-1 sm:px-0">

      {/* Page Heading */}
      <div className="flex flex-col gap-1">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Gate QR Verification</h2>
        <p className="text-xs sm:text-sm text-gray-500">Scan a student's approved Exit Pass QR code to verify campus departure.</p>
      </div>

      {/* MAIN SCANNER / VERIFICATION CONTAINER */}
      {!passData ? (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden p-4 sm:p-6 space-y-4 w-full">

          {!showFileUpload ? (
            /* CAMERA SCANNER VIEW */
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-blue-600 text-sm">photo_camera</span>
                  Live Camera Scanner
                </span>
                {isScanning && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                    Camera Active
                  </span>
                )}
              </div>

              {/* QR Reader Viewport */}
              <div className="relative w-full aspect-square max-w-sm mx-auto rounded-2xl border-2 border-gray-200 bg-black overflow-hidden flex flex-col items-center justify-center shadow-inner">
                <div id="qr-reader" className="w-full h-full object-cover"></div>

                {/* Hidden container for file scan */}
                <div id="qr-reader-temp" className="hidden"></div>

                {/* Camera Overlay Reticle */}
                {isScanning && (
                  <div className="absolute inset-0 pointer-events-none border-2 border-dashed border-blue-400/60 rounded-2xl m-8 flex items-center justify-center">
                    <div className="w-full h-0.5 bg-blue-500/80 shadow-lg shadow-blue-500/50 animate-pulse"></div>
                  </div>
                )}

                {/* Loading / Verifying State */}
                {loading && (
                  <div className="absolute inset-0 bg-black/75 backdrop-blur-xs flex flex-col items-center justify-center text-white space-y-2 z-10">
                    <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-xs font-bold">Verifying Exit Pass QR...</p>
                  </div>
                )}
              </div>

              {/* Camera Error Banner & Controls */}
              {cameraError && (
                <div className="p-3.5 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl text-xs space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="material-symbols-outlined text-[18px] text-amber-600 flex-shrink-0">warning</span>
                    <span>{cameraError}</span>
                  </div>
                  <button
                    onClick={startCamera}
                    className="w-full py-2 bg-amber-600 text-white rounded-lg text-xs font-bold hover:bg-amber-700 transition-colors"
                  >
                    Allow Camera / Retry
                  </button>
                </div>
              )}

              {/* Fallback Switcher */}
              <div className="pt-2 border-t border-gray-100 flex flex-col sm:flex-row gap-2 justify-between items-center">
                <button
                  onClick={startCamera}
                  className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">refresh</span>
                  Restart Camera
                </button>
                <button
                  onClick={() => { stopCamera(); setShowFileUpload(true); }}
                  className="text-xs font-bold text-gray-600 hover:text-gray-900 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">upload_file</span>
                  Upload QR Image instead
                </button>
              </div>
            </div>
          ) : (
            /* IMAGE FILE UPLOAD VIEW */
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-blue-600 text-sm">upload_file</span>
                  Upload QR Image Fallback
                </span>
                <button
                  onClick={() => { setShowFileUpload(false); startCamera(); }}
                  className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px]">videocam</span>
                  Switch to Camera
                </button>
              </div>

              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 hover:border-blue-500 bg-gray-50 hover:bg-blue-50/40 rounded-2xl p-8 text-center cursor-pointer transition-all space-y-2"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <div className="w-12 h-12 bg-white rounded-xl mx-auto flex items-center justify-center border border-gray-200 shadow-xs">
                  <span className="material-symbols-outlined text-2xl text-blue-600">file_upload</span>
                </div>
                <p className="text-xs font-bold text-gray-800">Tap to upload QR image from gallery</p>
                <p className="text-[11px] text-gray-400">Supports PNG, JPG, or screenshot files</p>
              </div>

              {uploadingImage && (
                <div className="p-3 bg-blue-50 text-blue-800 rounded-xl text-xs flex items-center gap-2 font-semibold">
                  <span className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></span>
                  Decoding QR code from image...
                </div>
              )}
            </div>
          )}

          {/* Verification Error Box */}
          {error && (
            <div className={`p-4 border rounded-xl text-xs flex items-start gap-2.5 leading-relaxed ${
              error.includes('ALREADY USED') ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-red-50 border-red-200 text-red-700'
            }`}>
              <span className="material-symbols-outlined text-[18px] flex-shrink-0 mt-0.5">
                {error.includes('ALREADY USED') ? 'warning' : 'error'}
              </span>
              <div>
                <p className="font-bold">{error.includes('ALREADY USED') ? 'QR ALREADY USED' : 'Verification Error'}</p>
                <p>{error}</p>
              </div>
            </div>
          )}

          {/* Security Rules Box */}
          <div className="p-4 bg-blue-50/60 border border-blue-100 rounded-xl space-y-1.5">
            <h4 className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm font-semibold">shield</span>
              Gate Security Rules
            </h4>
            <ul className="text-[11px] text-blue-800/80 space-y-1 pl-4 list-disc leading-relaxed">
              <li>Only approved, unexpired Exit Pass QR codes verify successfully.</li>
              <li>Single-use security: second scan attempt will be rejected.</li>
              <li>Guard-binding: only the scanning guard may confirm campus exit.</li>
              <li>Verify that student photo matches the person present at the gate.</li>
            </ul>
          </div>

        </div>
      ) : (
        /* VERIFIED STUDENT PROFILE CARD */
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-md w-full">

          {/* QR Verified Header Notice */}
          <div className="bg-emerald-600 text-white px-5 py-3 flex items-center gap-2 text-xs font-bold">
            <span className="material-symbols-outlined text-white text-[20px]">verified</span>
            <span>✓ QR VERIFIED &amp; CONSUMED — Confirm departure below</span>
          </div>

          {/* Profile Card Header */}
          <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row gap-4 items-start sm:items-center bg-gray-50/50">
            {passData.student?.photoUrl ? (
              <img
                src={passData.student.photoUrl}
                alt="Student Profile"
                className="w-20 h-20 object-cover rounded-2xl border border-gray-200 shadow-xs"
              />
            ) : (
              <div className="w-20 h-20 bg-blue-600 text-white rounded-2xl flex items-center justify-center font-bold text-2xl uppercase shadow-xs">
                {passData.student?.name?.slice(0, 2) || 'ST'}
              </div>
            )}

            <div className="flex-1 min-w-0">
              <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-200 uppercase tracking-wide mb-1">
                Approved Exit Pass
              </span>
              <h3 className="text-lg sm:text-xl font-black text-gray-900 truncate">{passData.student?.name}</h3>
              <p className="text-xs font-mono text-gray-500 mt-0.5">{passData.student?.roll}</p>
            </div>
          </div>

          {/* Pass Details Grid */}
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-y-3.5 gap-x-6 text-xs">
            <div>
              <span className="block font-bold text-gray-400 uppercase tracking-wider text-[10px]">Branch &amp; Section</span>
              <span className="font-bold text-gray-900 mt-0.5 block text-sm">
                {passData.student?.branch} — Year {passData.student?.year} ({passData.student?.section || 'A'})
              </span>
            </div>
            <div>
              <span className="block font-bold text-gray-400 uppercase tracking-wider text-[10px]">Destination</span>
              <span className="font-bold text-gray-900 mt-0.5 block text-sm truncate">{passData.destination}</span>
            </div>
            <div className="sm:col-span-2">
              <span className="block font-bold text-gray-400 uppercase tracking-wider text-[10px]">Reason for Leave</span>
              <p className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-700 mt-1 italic">
                "{passData.reason}"
              </p>
            </div>
            <div>
              <span className="block font-bold text-gray-400 uppercase tracking-wider text-[10px]">Requested Exit Time</span>
              <span className="text-gray-800 mt-0.5 block font-mono font-semibold">{formatDateTime(passData.exitTime)}</span>
            </div>
            <div>
              <span className="block font-bold text-gray-400 uppercase tracking-wider text-[10px]">Emergency Contact</span>
              <span className="text-gray-800 mt-0.5 block font-mono font-bold text-sm">{passData.emergencyContact || 'N/A'}</span>
            </div>

            {passData.adminRemark && (
              <div className="sm:col-span-2">
                <span className="block font-bold text-gray-400 uppercase tracking-wider text-[10px]">Admin Remarks</span>
                <p className="text-blue-800 bg-blue-50 border border-blue-100 p-2.5 rounded-xl mt-0.5 font-medium">{passData.adminRemark}</p>
              </div>
            )}
          </div>

          {/* Status Banners */}
          {(error || successMsg || forbiddenMsg || alreadyExited) && (
            <div className="px-5 py-2 space-y-2">
              {forbiddenMsg && (
                <div className="p-3 bg-amber-50 border border-amber-300 text-amber-900 rounded-xl text-xs flex items-start gap-2 font-semibold">
                  <span className="material-symbols-outlined text-[18px] text-amber-600 flex-shrink-0">shield_lock</span>
                  <div>
                    <p className="font-black mb-0.5">Guard-Binding Security Warning</p>
                    <p>{forbiddenMsg}</p>
                  </div>
                </div>
              )}
              {alreadyExited && (
                <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 rounded-xl text-xs flex items-center gap-2 font-semibold">
                  <span className="material-symbols-outlined text-[16px]">how_to_reg</span>
                  <span>Exit Already Confirmed — Departure has already been recorded.</span>
                </div>
              )}
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px]">error</span>
                  <span>{error}</span>
                </div>
              )}
              {successMsg && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2 font-bold">
                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                  <span>{successMsg}</span>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons Footer */}
          <div className="bg-gray-50 px-5 py-4 flex flex-col sm:flex-row gap-3 justify-between items-stretch sm:items-center border-t border-gray-100">
            <button
              onClick={handleReset}
              className="w-full sm:w-auto px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl text-xs font-bold hover:bg-gray-100 transition-all text-center"
              disabled={verifying}
            >
              Cancel / Scan Next
            </button>

            <div className="flex flex-col sm:flex-row gap-2.5">
              {!successMsg && !alreadyExited && (
                <>
                  <button
                    onClick={() => setShowMismatchModal(true)}
                    className="w-full sm:w-auto px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-all"
                    disabled={verifying}
                  >
                    <span className="material-symbols-outlined text-[15px]">warning</span>
                    Identity Mismatch
                  </button>
                  <button
                    onClick={handleConfirmExit}
                    className="w-full sm:w-auto px-5 py-2.5 bg-gray-900 text-white hover:bg-black rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.98]"
                    disabled={verifying}
                  >
                    {verifying ? (
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-[16px]">how_to_reg</span>
                        <span>Confirm Exit &amp; Record</span>
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>

        </div>
      )}

      {/* Identity Mismatch Modal */}
      {showMismatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white border border-gray-200 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-xl space-y-4 animate-reveal">
            <h3 className="text-sm sm:text-base font-bold text-gray-900 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-red-600 text-[20px]">warning</span>
              Report Identity Mismatch
            </h3>
            <p className="text-xs text-gray-500 leading-relaxed">
              This action blocks the exit pass, suspends it under review, and logs a security audit event.
            </p>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Mismatch details / Observation *</label>
              <textarea
                className="w-full h-24 border border-gray-200 rounded-xl p-3 focus:outline-none focus:border-red-500 focus:ring-4 focus:ring-red-500/10 text-xs resize-none"
                placeholder="E.g. Profile photo does not match student at gate; wrong roll number"
                value={mismatchReason}
                onChange={e => setMismatchReason(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex gap-2.5 justify-end">
              <button
                onClick={() => setShowMismatchModal(false)}
                className="px-4 py-2 border border-gray-200 rounded-xl text-xs font-semibold text-gray-600 hover:bg-gray-100"
                disabled={reportingMismatch}
              >
                Cancel
              </button>
              <button
                onClick={handleRejectIdentity}
                className="px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700 flex items-center gap-1.5 shadow-sm"
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
