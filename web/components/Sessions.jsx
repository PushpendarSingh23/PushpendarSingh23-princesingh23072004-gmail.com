import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { Action } from './Action.jsx';

export function Sessions({ orgId, orgPermissions, currentUser }) {
  const [sessions, setSessions] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [selectedMode, setSelectedMode] = useState('control');
  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [sessionsRes, devicesRes] = await Promise.allSettled([
        api.getSessions(orgId),
        api.getDevices(orgId),
      ]);

      if (sessionsRes.status === 'fulfilled') {
        setSessions(sessionsRes.value.sessions || []);
      }
      if (devicesRes.status === 'fulfilled') {
        setDevices(devicesRes.value.devices || []);
        if (devicesRes.value.devices?.length > 0 && !selectedDevice) {
          setSelectedDevice(devicesRes.value.devices[0].id);
        }
      }
      setError(null);
    } catch (err) {
      setError(err.message || 'failed to load sessions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [orgId]);

  const handleStartSession = async (e) => {
    e.preventDefault();
    if (!selectedDevice) return;

    setSubmitting(true);
    try {
      await api.startSession(orgId, selectedDevice, selectedMode);
      setShowModal(false);
      await loadData();
    } catch (err) {
      alert(err.message || 'Failed to start session');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTerminate = async (session) => {
    if (!window.confirm(`Terminate session on ${session.deviceName || session.deviceId}?`)) return;

    try {
      await api.terminateSession(orgId, session.id);
      await loadData();
    } catch (err) {
      alert(err.message || 'Failed to terminate session');
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Active Sessions</h2>
        <Action
          permission="session:start"
          permissions={orgPermissions}
          data-testid="new-session"
          className="btn btn-primary"
          onClick={() => setShowModal(true)}
        >
          New Session
        </Action>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <p>Loading sessions…</p>
      ) : sessions.length === 0 ? (
        <div data-testid="sessions-empty" className="empty-state">
          No active or recent remote sessions.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Session ID</th>
              <th>Device</th>
              <th>User</th>
              <th>Mode</th>
              <th>Started</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => {
              const isOwnerOrTerminator = orgPermissions?.['session:terminate']?.effect === 'allow';
              const isSelf = currentUser && (session.userId === currentUser.id || session.user_id === currentUser.id);
              const canTerminate = isOwnerOrTerminator || isSelf;

              return (
                <tr
                  key={session.id}
                  data-testid="session-row"
                  data-session-id={session.id}
                >
                  <td>
                    <code>{session.id.slice(0, 12)}…</code>
                  </td>
                  <td>
                    <strong>{session.deviceName || session.deviceId}</strong>
                  </td>
                  <td>{session.userName || session.userId}</td>
                  <td>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        backgroundColor: '#e0f2fe',
                        color: '#0369a1',
                        textTransform: 'uppercase',
                      }}
                    >
                      {session.mode}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.85rem', color: '#64748b' }}>
                    {session.startedAt ? new Date(session.startedAt * 1000).toLocaleTimeString() : '—'}
                  </td>
                  <td>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: session.active ? '#34d399' : '#94a3b8',
                        marginRight: 6,
                      }}
                    />
                    {session.active ? 'Active' : 'Ended'}
                  </td>
                  <td>
                    {session.active && canTerminate && (
                      <button
                        data-testid="stop-session"
                        data-permission="session:terminate"
                        data-state="unlocked"
                        className="btn btn-danger"
                        onClick={() => handleTerminate(session)}
                      >
                        Terminate
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Start Remote Session</h3>
            <form onSubmit={handleStartSession}>
              <div className="form-group">
                <label className="form-label" htmlFor="session-device">
                  Device
                </label>
                <select
                  id="session-device"
                  data-testid="session-device"
                  className="select"
                  value={selectedDevice}
                  onChange={(e) => setSelectedDevice(e.target.value)}
                  required
                >
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.kind})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="session-mode">
                  Session Mode
                </label>
                <select
                  id="session-mode"
                  data-testid="session-mode"
                  className="select"
                  value={selectedMode}
                  onChange={(e) => setSelectedMode(e.target.value)}
                >
                  <option value="view">view</option>
                  <option value="control">control</option>
                  <option value="terminal">terminal</option>
                  <option value="file_transfer">file_transfer</option>
                </select>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button
                  data-testid="session-submit"
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting}
                >
                  {submitting ? 'Starting…' : 'Start Session'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
