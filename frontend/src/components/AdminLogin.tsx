import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminLogin, ApiError } from '../api';
import { loadAdminToken, saveAdminToken } from '../lib/adminSession';

export default function AdminLogin() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (loadAdminToken()) {
      navigate('/admin', { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password.trim()) {
      setError('Enter the admin password');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await adminLogin(password.trim());
      saveAdminToken(result.token);
      navigate('/admin', { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page sheet">
      <section className="host-form admin-shell">
        <h1>Admin</h1>
        <p className="tagline">Enter the admin password to manage database question banks.</p>
        <form onSubmit={handleSubmit} className="stack">
          <label className="field">
            <span>Password</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="primary" disabled={loading}>
            {loading ? 'Checking...' : 'Enter Admin'}
          </button>
          <Link to="/" className="secondary-link">
            Back home
          </Link>
        </form>
      </section>
    </main>
  );
}
