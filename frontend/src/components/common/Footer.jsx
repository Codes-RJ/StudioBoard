import { FiLogIn, FiLogOut, FiShield } from 'react-icons/fi';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useDashboard } from '../../context/DashboardContext';
import { SiteFooter } from './SiteChrome';
import { SERVER_WORKSPACE_ENABLED } from '../../config/workspace';

export default function Footer() {
  const { isAuthenticated, logout, user } = useAuth();
  const { confirmDiscardLayoutChanges } = useDashboard();
  const { pathname } = useLocation();
  const handleNavigation = (event, destination) => {
    if (pathname !== destination && !confirmDiscardLayoutChanges()) event.preventDefault();
  };
  return <SiteFooter onNavigate={handleNavigation} accountLinks={<>
    {SERVER_WORKSPACE_ENABLED && user?.role === 'ADMIN' && <Link to="/admin" onClick={(event) => handleNavigation(event, '/admin')}><FiShield aria-hidden="true" />Admin</Link>}
    {SERVER_WORKSPACE_ENABLED && (isAuthenticated ? <button type="button" onClick={() => { if (confirmDiscardLayoutChanges()) void logout(); }}><FiLogOut aria-hidden="true" />Sign out</button> : <Link to="/login" onClick={(event) => handleNavigation(event, '/login')}><FiLogIn aria-hidden="true" />Login</Link>)}
  </>} />;
}
