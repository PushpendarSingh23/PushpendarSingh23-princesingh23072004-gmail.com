import React, { useState } from 'react';
import { api, setAccessToken } from '../api.js';

export function Login({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!email.trim() || !password.trim()) {
      setError('email and password are required');
      setErrorCode('VALIDATION');
      return;
    }

    setLoading(true);
    setError(null);
    setErrorCode(null);

    try {
      const data = await api.login(email.trim(), password);
      setAccessToken(data.token);
      onLoginSuccess(data);
    } catch (err) {
      setError(err.message || 'invalid email or password');
      setErrorCode(err.code || 'UNAUTHENTICATED');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="auth-title">RemoteOps</h1>
        <p className="auth-subtitle">Sign in to your control plane</p>

        {error && (
          <div
            data-testid="login-error"
            data-error-code={errorCode}
            role="alert"
            aria-live="polite"
            className="error-banner"
          >
            {error}
          </div>
        )}

        <form data-testid="login-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              data-testid="login-email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.test"
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              data-testid="login-password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          <button
            data-testid="login-submit"
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
            disabled={loading}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
