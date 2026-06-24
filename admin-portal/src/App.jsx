import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AdminLayout from './layouts/AdminLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Announcements from './pages/Announcements';
import Placements from './pages/Placements';
import FeeNotices from './pages/FeeNotices';
import ExitPasses from './pages/ExitPasses';
import Notifications from './pages/Notifications';
import Settings from './pages/Settings';
import SecurityDashboard from './pages/SecurityDashboard';
import SecurityVerifyOtp from './pages/SecurityVerifyOtp';
import SecurityHistory from './pages/SecurityHistory';
import { authStore } from './store/authStore';

function ProtectedRoute({ children, allowedRoles }) {
  if (!authStore.isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  const user = authStore.getUser();
  if (allowedRoles && !allowedRoles.includes(user?.role)) {
    if (user?.role === 'SECURITY_GUARD') {
      return <Navigate to="/security/dashboard" replace />;
    }
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

function PublicRoute({ children }) {
  if (authStore.isAuthenticated()) {
    const user = authStore.getUser();
    if (user?.role === 'SECURITY_GUARD') {
      return <Navigate to="/security/dashboard" replace />;
    }
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

function RootRedirect() {
  if (!authStore.isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  const user = authStore.getUser();
  if (user?.role === 'SECURITY_GUARD') {
    return <Navigate to="/security/dashboard" replace />;
  }
  return <Navigate to="/dashboard" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicRoute>
            <Login />
          </PublicRoute>
        }
      />
      <Route element={<AdminLayout />}>
        {/* General Admin Routes */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN']}>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/announcements"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'PLACEMENT_ADMIN']}>
              <Announcements />
            </ProtectedRoute>
          }
        />
        <Route
          path="/placements"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'PLACEMENT_ADMIN']}>
              <Placements />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fee-notices"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ACCOUNTS_ADMIN']}>
              <FeeNotices />
            </ProtectedRoute>
          }
        />
        <Route
          path="/exit-passes"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
              <ExitPasses />
            </ProtectedRoute>
          }
        />
        <Route
          path="/notifications"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'PLACEMENT_ADMIN']}>
              <Notifications />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN']}>
              <Settings />
            </ProtectedRoute>
          }
        />

        {/* Security Guard Routes */}
        <Route
          path="/security/dashboard"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'SECURITY_GUARD']}>
              <SecurityDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/security/verify-otp"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'SECURITY_GUARD']}>
              <SecurityVerifyOtp />
            </ProtectedRoute>
          }
        />
        <Route
          path="/security/history"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'SECURITY_GUARD']}>
              <SecurityHistory />
            </ProtectedRoute>
          }
        />

        {/* Catch-all Redirect */}
        <Route path="*" element={<RootRedirect />} />
      </Route>
      <Route path="/" element={<RootRedirect />} />
    </Routes>
  );
}
