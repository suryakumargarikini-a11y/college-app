import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { authStore } from '../store/authStore';
import adminBanner from '../admin_banner.png';

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
    <main className="grid grid-cols-12 min-h-screen w-full bg-[#f7f9fb] select-none">
      {/* Left Side: Branding Banner (Hidden on Mobile) */}
      <section className="hidden lg:flex lg:col-span-7 bg-[#004ac6] relative flex-col justify-between p-12 overflow-hidden">
        {/* Glow effects */}
        <div className="absolute inset-0 opacity-20 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full bg-blue-400 blur-[120px]"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-300 blur-[120px]"></div>
        </div>

        {/* Branding Logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-white font-bold text-[40px]">account_balance</span>
            <h1 className="text-3xl font-extrabold text-white tracking-tighter">SITAM ERP</h1>
          </div>
        </div>

        {/* Illustration & Content */}
        <div className="relative z-10 flex flex-col items-center max-w-xl mx-auto text-center">
          <div className="w-80 h-80 mb-8 transform hover:scale-[1.02] transition-transform duration-500 flex items-center justify-center">
            <img className="max-w-full max-h-full drop-shadow-2xl rounded-2xl object-contain border border-white/10" src={adminBanner} alt="SITAM Admin Portal Banner" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-4">SITAM Smart ERP - Administration Portal</h2>
          <p className="text-white/80 text-sm leading-relaxed px-6">
            The centralized management hub for SITAM institutions. Empowering administrators with real-time data, role-based workflows, and detailed audit history.
          </p>
        </div>

        {/* Footer Badge */}
        <div className="relative z-10 flex justify-between items-center text-white/50 text-xs font-mono">
          <span>V 4.5.0-ENTERPRISE</span>
          <span>TRUSTED BY 50+ INSTITUTIONS</span>
        </div>
      </section>

      {/* Right Side: Login Form Card */}
      <section className="col-span-12 lg:col-span-5 bg-[#f7f9fb] flex flex-col items-center justify-center p-6 relative">
        {/* Floating System Status */}
        <div className="absolute top-6 right-6 flex items-center gap-3">
          <div className="flex flex-col items-end text-xs">
            <span className="font-semibold text-gray-700">{currentDate}</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="font-mono text-[10px] text-gray-500 uppercase tracking-widest">Portal Online</span>
            </div>
          </div>
        </div>

        {/* Login Container */}
        <div className="w-full max-w-[420px] space-y-6">
          <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <div className="mb-6 text-center lg:text-left">
              <h3 className="text-xl font-bold text-gray-900">Admin Sign In</h3>
              <p className="text-sm text-gray-500 mt-1">Enter your credentials to access the portal</p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                <span className="material-symbols-outlined text-sm">error</span>
                <span>{error}</span>
              </div>
            )}

            <form className="space-y-4" onSubmit={handleSubmit}>
              {/* Email */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider" htmlFor="email">Email Address</label>
                <div className="relative group">
                  <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-600 transition-colors text-[20px]">alternate_email</span>
                  <input
                    className="w-full h-11 pl-11 pr-4 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all text-sm text-gray-800 placeholder:text-gray-400"
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
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider" htmlFor="password">Password</label>
                </div>
                <div className="relative group">
                  <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-600 transition-colors text-[20px]">lock</span>
                  <input
                    className="w-full h-11 pl-11 pr-11 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all text-sm text-gray-800 placeholder:text-gray-400"
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
                    <span className="material-symbols-outlined text-[20px]">{showPassword ? 'visibility_off' : 'visibility'}</span>
                  </button>
                </div>
              </div>

              {/* Options */}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500/20"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                  />
                  <span className="text-xs text-gray-500 group-hover:text-gray-700 transition-colors select-none">Remember Me</span>
                </label>
                <a className="text-xs text-blue-600 font-semibold hover:underline" href="#/forgot">Forgot Password?</a>
              </div>

              {/* Sign In Button */}
              <button
                className="w-full h-11 mt-2 bg-blue-600 text-white font-semibold text-sm rounded-xl hover:bg-blue-700 hover:shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
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

          {/* Footer branding */}
          <div className="text-center">
            <p className="text-xs text-gray-400">
              SITAM Smart ERP Administration Portal
            </p>
            <p className="text-[10px] text-gray-400/60 uppercase tracking-widest mt-1">
              © 2026 SITAM Institutional Group
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
