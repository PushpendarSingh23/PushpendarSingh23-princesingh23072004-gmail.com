import React, { useState, useEffect } from 'react';
import { api } from '../api.js';

export function AcceptInvite({ token, onAccepted }) {
  const [invite, setInvite] = useState(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function loadInvite() {
      try {
        const data = await api.peekInvite(token);
        setInvite(data);
      } catch (err) {
        setError(err.message || 'invalid or expired invite link');
      } finally {
        setLoading(false);
      }
    }
    loadInvite();
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password || password.length < 6) {
      setError('password must be at least 6 characters');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await api.acceptInvite(token, name.trim(), password);
      onAccepted();
    } catch (err) {
      setError(err.message || 'failed to accept invite');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <p>Loading invite details…</p>
        </div>
      </div>
    );
  }

  if (error && !invite) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <h1 className="auth-title">Invalid Invite</h1>
          <div data-testid="invite-error" role="alert" className="error-banner">
            {error}
          </div>
          <button className="btn btn-secondary" onClick={() => onAccepted()}>
            Back to Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="auth-title">Accept Invitation</h1>
        <p className="auth-subtitle">
          You have been invited to join <strong data-testid="invite-org-name">{invite?.orgName}</strong> as{' '}
          <span data-testid="invite-role" className="role-badge">
            {invite?.role}
          </span>
        </p>

        {error && (
          <div data-testid="invite-error" role="alert" className="error-banner">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="invite-email">
              Email
            </label>
            <input
              id="invite-email"
              data-testid="invite-email"
              type="email"
              className="input"
              value={invite?.email || ''}
              readOnly
              disabled
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="invite-name">
              Full Name
            </label>
            <input
              id="invite-name"
              data-testid="invite-name"
              type="text"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your Name"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="invite-password">
              Set Password
            </label>
            <input
              id="invite-password"
              data-testid="invite-password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <button
            data-testid="invite-submit"
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
            disabled={submitting}
          >
            {submitting ? 'Accepting…' : 'Accept and Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
