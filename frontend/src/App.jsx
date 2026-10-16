import { Suspense, lazy } from 'react';
import { Toaster } from 'react-hot-toast';
import { Navigate, Route, BrowserRouter as Router, Routes, useLocation } from 'react-router-dom';
import { SERVER_WORKSPACE_ENABLED } from './config/workspace';
import ErrorBoundary from './components/common/ErrorBoundary';
import Footer from './components/common/Footer';
import PageSkeleton from './components/common/PageSkeleton';
import Navbar from './components/common/Navbar';
import PageMetadata from './components/common/PageMetadata';
import { AuthProvider } from './context/AuthContext';
import { DashboardProvider } from './context/DashboardContext';
import { OperationStatusProvider } from './context/OperationStatusContext';
import { SiteSettingsProvider } from './context/SiteSettingsContext';

// Lazy load pages for fast code splitting
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/Login'));
const Admin = lazy(() => import('./pages/Admin'));
const Upload = lazy(() => import('./pages/Upload'));
const NotFound = lazy(() => import('./pages/NotFound'));
const Privacy = lazy(() => import('./pages/Privacy'));
const Terms = lazy(() => import('./pages/Terms'));
const HowItWorks = lazy(() => import('./pages/HowItWorks'));

function AppShell() {
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen flex flex-col">
      <PageMetadata />
      <Navbar />
      <main id="main-content" className="grow" tabIndex={-1}>
        <ErrorBoundary>
          <Suspense key={pathname} fallback={<PageSkeleton />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/how-it-works" element={<HowItWorks />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/upload" element={<Upload />} />
              <Route path="/login" element={SERVER_WORKSPACE_ENABLED ? <Login /> : <Navigate to="/dashboard" replace />} />
              <Route path="/admin" element={SERVER_WORKSPACE_ENABLED ? <Admin /> : <Navigate to="/dashboard" replace />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
      <Footer />
      <Toaster 
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#fafbf7',
            color: '#202823',
            border: '1px solid #cbd1c4',
          },
        }}
      />
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <AuthProvider>
          <SiteSettingsProvider>
            <DashboardProvider>
              <OperationStatusProvider>
                <AppShell />
              </OperationStatusProvider>
            </DashboardProvider>
          </SiteSettingsProvider>
        </AuthProvider>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
