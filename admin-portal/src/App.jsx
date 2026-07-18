import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AdminLayout from './layouts/AdminLayout';
import { authStore } from './store/authStore';

/* ── Lazy-loaded pages (code splitting) ── */
const Login             = lazy(() => import('./pages/Login'));
const Dashboard         = lazy(() => import('./pages/Dashboard'));
const Announcements     = lazy(() => import('./pages/Announcements'));
const Placements        = lazy(() => import('./pages/Placements'));
const FeeNotices        = lazy(() => import('./pages/FeeNotices'));
const ExitPasses        = lazy(() => import('./pages/ExitPasses'));
const Notifications     = lazy(() => import('./pages/Notifications'));
const Settings          = lazy(() => import('./pages/Settings'));
const SecurityDashboard = lazy(() => import('./pages/SecurityDashboard'));
const SecurityVerifyOtp = lazy(() => import('./pages/SecurityVerifyOtp'));
const SecurityHistory   = lazy(() => import('./pages/SecurityHistory'));
const Students          = lazy(() => import('./pages/Students'));
const Faculty           = lazy(() => import('./pages/Faculty'));
const AttendanceDashboard = lazy(() => import('./pages/AttendanceDashboard'));
const MarksLedger       = lazy(() => import('./pages/MarksLedger'));
const FeesDashboard     = lazy(() => import('./pages/FeesDashboard'));
const PlacementsDashboard = lazy(() => import('./pages/PlacementsDashboard'));
const LmsDashboard      = lazy(() => import('./pages/LmsDashboard'));
const Analytics         = lazy(() => import('./pages/Analytics'));
const RiskDashboard     = lazy(() => import('./pages/RiskDashboard'));
const ActivityCenter    = lazy(() => import('./pages/ActivityCenter'));
const ELibrary          = lazy(() => import('./pages/ELibrary'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

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
    <Suspense fallback={<PageLoader />}>
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
          path="/students"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN']}>
              <Students />
            </ProtectedRoute>
          }
        />
        <Route
          path="/faculty"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
              <Faculty />
            </ProtectedRoute>
          }
        />
        <Route
          path="/attendance-dashboard"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN']}>
              <AttendanceDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/marks-ledger"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'PLACEMENT_ADMIN']}>
              <MarksLedger />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fees-dashboard"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ACCOUNTS_ADMIN']}>
              <FeesDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/placements-dashboard"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'PLACEMENT_ADMIN']}>
              <PlacementsDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lms-dashboard"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN']}>
              <LmsDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/analytics"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN']}>
              <Analytics />
            </ProtectedRoute>
          }
        />
        <Route
          path="/risk-dashboard"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN']}>
              <RiskDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/activity-center"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN']}>
              <ActivityCenter />
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
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'FACULTY']}>
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
        <Route path="/e-library" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'PLACEMENT_ADMIN', 'FACULTY']}><ELibrary /></ProtectedRoute>} />
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
    </Suspense>
  );
}
