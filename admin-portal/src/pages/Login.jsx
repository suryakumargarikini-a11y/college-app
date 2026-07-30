import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { authStore } from '../store/authStore';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentTime, setCurrentTime] = useState('');
  const [currentDate, setCurrentDate] = useState('');

  // Clock update loop
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('en-GB', { hour12: false }));
      
      const dateOptions = { day: '2-digit', month: 'short', year: 'numeric' };
      setCurrentDate(now.toLocaleDateString('en-GB', dateOptions).toUpperCase());
    };
    
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Load remembered email on mount
  useEffect(() => {
    const savedEmail = localStorage.getItem('remembered_admin_email');
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await api.post('/admin/auth/login', { email, password });
      
      // Save credentials if Remember Me is checked
      if (rememberMe) {
        localStorage.setItem('remembered_admin_email', email);
      } else {
        localStorage.removeItem('remembered_admin_email');
      }

      authStore.setAuth(res.data.token, res.data.admin);

      // Role-based redirection
      if (res.data.admin.role === 'SECURITY_GUARD') {
        navigate('/security/dashboard');
      } else if (res.data.admin.role === 'HOSTEL_WARDEN' || res.data.admin.role === 'FACULTY') {
        navigate('/exit-passes');
      } else {
        navigate('/dashboard');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Invalid credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="grid grid-cols-12 min-h-screen w-full bg-[#f8fafc] select-none font-sans">
      {/* Left Side: Campus Image Banner (Hidden on Mobile/Tablet down to lg) */}
      <section className="hidden lg:flex lg:col-span-7 relative flex-col justify-between p-10 overflow-hidden">
        {/* Full Campus Background Image */}
        <img 
          src="/sitam-campus.jpg" 
          alt="SITAM Campus" 
          className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none"
        />

        {/* Top-Left Branding */}
        <div className="relative z-10 flex items-center gap-3">
          <span className="material-symbols-outlined text-white font-bold text-[36px] drop-shadow-md">account_balance</span>
          <h1 className="text-3xl font-extrabold text-white tracking-tight drop-shadow-md">SITAM ERP</h1>
        </div>

        {/* Bottom Footer Info Badges */}
        <div className="relative z-10 flex justify-between items-center text-white/90 text-xs font-semibold tracking-wider font-mono drop-shadow-md">
          <span>V 4.5.0-ENTERPRISE</span>
          <span>TRUSTED BY 50+ INSTITUTIONS</span>
        </div>
      </section>

      {/* Right Side: Login Form Card */}
      <section className="col-span-12 lg:col-span-5 bg-[#f8fafc] flex flex-col justify-between items-center p-6 lg:p-10 relative min-h-screen">
        {/* Top-Right System Status */}
        <div className="w-full flex justify-end">
          <div className="flex flex-col items-end text-xs">
            <span className="font-semibold text-gray-800 tracking-wider">{currentDate}</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="font-mono text-[10px] text-gray-500 uppercase tracking-widest">Portal Online</span>
            </div>
          </div>
        </div>

        {/* Central Content: Logo + Login Card */}
        <div className="w-full max-w-[420px] my-auto space-y-6 flex flex-col items-center">
          {/* Official SITAM Circular Logo */}
          <div className="flex justify-center mb-2">
            <img 
              src="/sitam-logo.png" 
              alt="SITAM Official Logo" 
              className="w-36 h-36 lg:w-44 lg:h-44 object-contain" 
            />
          </div>

          {/* Login Card */}
          <div className="w-full bg-white border border-gray-100 rounded-2xl p-8 shadow-[0_10px_35px_rgba(0,0,0,0.05)]">
            <div className="mb-6 text-left">
              <h2 className="text-xl font-bold text-gray-900">Admin Sign In</h2>
              <p className="text-sm text-gray-500 mt-1">Enter your credentials to access the portal</p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                <span className="material-symbols-outlined text-sm">error</span>
                <span>{error}</span>
              </div>
            )}

            <form className="space-y-4" onSubmit={handleSubmit}>
              {/* Email Address */}
              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider" htmlFor="email">
                  Email Address
                </label>
                <div className="relative group">
                  <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-600 transition-colors text-[20px]">
                    alternate_email
                  </span>
                  <input
                    className="w-full h-11 pl-11 pr-4 bg-[#f8fafc] border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 transition-all text-sm text-gray-900 placeholder:text-gray-400"
                    id="email"
                    type="email"
                    required
                    placeholder="admin@sitamecap.co.in"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider" htmlFor="password">
                    Password
                  </label>
                </div>
                <div className="relative group">
                  <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-600 transition-colors text-[20px]">
                    lock
                  </span>
                  <input
                    className="w-full h-11 pl-11 pr-11 bg-[#f8fafc] border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 transition-all text-sm text-gray-900 placeholder:text-gray-400"
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                  />
                  <button
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Remember Me & Forgot Password */}
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500/20"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                  />
                  <span className="text-xs text-gray-600 group-hover:text-gray-800 transition-colors select-none">
                    Remember Me
                  </span>
                </label>
                <a className="text-xs text-blue-600 font-semibold hover:underline" href="#/forgot">
                  Forgot Password?
                </a>
              </div>

              {/* Sign In Button */}
              <button
                className="w-full h-11 mt-2 bg-[#1a65ec] hover:bg-blue-700 text-white font-semibold text-sm rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                type="submit"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    <span>Authenticating...</span>
                  </>
                ) : (
                  <>
                    <span>Sign In</span>
                    <span className="material-symbols-outlined text-sm">arrow_forward</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Footer Branding */}
          <div className="text-center pt-2">
            <p className="text-xs text-gray-400 font-normal">
              SITAM Smart ERP Administration Portal
            </p>
            <p className="text-[10px] text-gray-400 uppercase tracking-widest mt-1">
              © 2026 SITAM INSTITUTIONAL GROUP
            </p>
          </div>
        </div>

        {/* Empty bottom spacer for column alignment */}
        <div className="h-2"></div>
      </section>
    </main>
  );
}

