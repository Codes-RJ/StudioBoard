import { useState } from 'react';
import { FiArrowRight, FiLock, FiMail } from 'react-icons/fi';
import { Navigate, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { describeApiError } from '../utils/apiError';

export default function Login() {
  const { isAuthenticated, loading, login, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!loading && isAuthenticated) {
    return <Navigate to={user?.role === 'ADMIN' ? '/admin' : '/dashboard'} replace />;
  }

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const loggedInUser = await login({ email, password });
      toast.success('Signed in');
      navigate(loggedInUser.role === 'ADMIN' ? '/admin' : '/dashboard', { replace: true });
    } catch (error) {
      toast.error(describeApiError(error, 'Sign-in failed. Check your email and password.').text);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="flex min-h-[calc(100svh-8rem)] items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md border border-slate-200 bg-white p-6 shadow-xs sm:p-8">
        <div className="mb-8">
          <span className="grid h-10 w-10 place-items-center bg-blue-600 text-white"><FiLock aria-hidden="true" /></span>
          <h1 className="mt-5 text-2xl font-bold text-slate-950">Sign in</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">Use the administrator account to access the managed workspace.</p>
        </div>
        <form className="space-y-5" onSubmit={submit}>
          <label className="block text-sm font-semibold text-slate-800" htmlFor="login-email">
            Email
            <span className="relative mt-2 block">
              <FiMail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input id="login-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="w-full border border-slate-300 py-2.5 pl-10 pr-3 text-base text-slate-950 outline-hidden focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
            </span>
          </label>
          <label className="block text-sm font-semibold text-slate-800" htmlFor="login-password">
            Password
            <span className="relative mt-2 block">
              <FiLock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="w-full border border-slate-300 py-2.5 pl-10 pr-3 text-base text-slate-950 outline-hidden focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
            </span>
          </label>
          <button type="submit" disabled={submitting || loading} className="inline-flex w-full items-center justify-center gap-2 bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
            {submitting ? 'Signing in' : 'Sign in'} <FiArrowRight aria-hidden="true" />
          </button>
        </form>
      </div>
    </section>
  );
}
