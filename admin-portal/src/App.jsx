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
const StaffManagement   = lazy(() => import('./pages/StaffManagement'));
const Achievements      = lazy(() => import('./pages/Achievements'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function getRedirectPath(role) {
  if (role === 'SECURITY_GUARD') return '/security/dashboard';
  if (role === 'HOSTEL_WARDEN') return '/exit-passes';
  if (role === 'FACULTY') return '/exit-passes';
  return '/dashboard';
}

function ProtectedRoute({ children, allowedRoles }) {
  if (!authStore.isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  const user = authStore.getUser();
  if (allowedRoles && !allowedRoles.includes(user?.role)) {
    return <Navigate to={getRedirectPath(user?.role)} replace />;
  }
  return children;
}

function PublicRoute({ children }) {
  if (authStore.isAuthenticated()) {
    const user = authStore.getUser();
    return <Navigate to={getRedirectPath(user?.role)} replace />;
  }
  return children;
}

function RootRedirect() {
  if (!authStore.isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  const user = authStore.getUser();
  return <Navigate to={getRedirectPath(user?.role)} replace />;
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
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN', 'HOD', 'DEAN', 'CI']}>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/students"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN', 'HOD', 'DEAN', 'CI', 'HOSTEL_WARDEN']}>
              <Students />
            </ProtectedRoute>
          }
        />
        <Route
          path="/faculty"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'DEAN']}>
              <Faculty />
            </ProtectedRoute>
          }
        />
        <Route
          path="/attendance-dashboard"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN', 'HOD', 'DEAN', 'CI']}>
              <AttendanceDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/marks-ledger"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'PLACEMENT_ADMIN', 'HOD', 'DEAN', 'CI']}>
              <MarksLedger />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fees-dashboard"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'DEAN', 'CI']}>
              <FeesDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/placements-dashboard"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'PLACEMENT_ADMIN', 'DEAN']}>
              <PlacementsDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lms-dashboard"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN', 'DEAN', 'CI']}>
              <LmsDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/analytics"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN', 'CI']}>
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
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN', 'DEAN', 'CI']}>
              <ActivityCenter />
            </ProtectedRoute>
          }
        />
        <Route
          path="/announcements"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'PLACEMENT_ADMIN', 'DEAN', 'CI']}>
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
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'DEAN', 'CI']}>
              <FeeNotices />
            </ProtectedRoute>
          }
        />
        <Route
          path="/exit-passes"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'FACULTY', 'HOD', 'DEAN', 'CI', 'HOSTEL_WARDEN']}>
              <ExitPasses />
            </ProtectedRoute>
          }
        />
        <Route
          path="/notifications"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'PLACEMENT_ADMIN', 'DEAN']}>
              <Notifications />
            </ProtectedRoute>
          }
        />
        <Route path="/e-library" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'PLACEMENT_ADMIN', 'FACULTY', 'HOD', 'DEAN', 'CI']}><ELibrary /></ProtectedRoute>} />
        <Route path="/achievements" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'HOD', 'DEAN', 'CI']}><Achievements /></ProtectedRoute>} />
        <Route
          path="/settings"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ACCOUNTS_ADMIN', 'PLACEMENT_ADMIN', 'DEAN', 'CI']}>
              <Settings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/staff-management"
          element={
            <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
              <StaffManagement />
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
