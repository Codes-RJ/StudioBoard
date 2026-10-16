import { FiLogOut, FiShield } from 'react-icons/fi';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useDashboard } from '../../context/DashboardContext';
import { SiteHeader } from './SiteChrome';
import toast from 'react-hot-toast';
import { describeApiError } from '../../utils/apiError';
import { SERVER_WORKSPACE_ENABLED } from '../../config/workspace';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { confirmDiscardLayoutChanges } = useDashboard();
  const handleNavigation = (event, destination) => {
    if (location.pathname !== destination && !confirmDiscardLayoutChanges()) event.preventDefault();
  };
  const signOut = async () => {
    if (!confirmDiscardLayoutChanges()) return;
    try { await logout(); navigate('/login', { replace: true }); }
    catch (error) { toast.error(describeApiError(error, 'Sign-out failed. Please retry.').text); }
  };
  return <SiteHeader onNavigate={handleNavigation} accountLinks={<>
    {SERVER_WORKSPACE_ENABLED && user?.role === 'ADMIN' && <Link to="/admin" onClick={(event) => handleNavigation(event, '/admin')} className="nav-link"><FiShield aria-hidden="true" />Admin</Link>}
    {SERVER_WORKSPACE_ENABLED && user && <button type="button" onClick={() => void signOut()} className="nav-link"><FiLogOut aria-hidden="true" />Sign out</button>}
  </>} />;
}
