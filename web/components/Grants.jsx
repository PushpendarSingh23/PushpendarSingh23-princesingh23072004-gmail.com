import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { Action } from './Action.jsx';

export function Grants({ orgId, orgPermissions }) {
  const [grants, setGrants] = useState([]);
  const [users, setUsers] = useState([]);
  const [devices, setDevices] = useState([]);
  const [availablePermissions, setAvailablePermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Modal / Form state
  const [showModal, setShowModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedDevice, setSelectedDevice] = useState('');
  const [selectedEffect, setSelectedEffect] = useState('allow');
  const [selectedPermissions, setSelectedPermissions] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [grantsRes, membersRes, devicesRes] = await Promise.allSettled([
        api.getGrants(orgId),
        api.getMembers(orgId),
        api.getDevices(orgId),
      ]);

      if (grantsRes.status === 'fulfilled') {
        setGrants(grantsRes.value.grants || []);
      }
      if (membersRes.status === 'fulfilled') {
        const mems = membersRes.value.members || membersRes.value.users || [];
        setUsers(mems);
        if (mems.length > 0 && !selectedUser) {
          setSelectedUser(mems[0].user_id || mems[0].id);
        }
      }
      if (devicesRes.status === 'fulfilled') {
        setDevices(devicesRes.value.devices || []);
      }

      setAvailablePermissions([
        'device:view',
        'device:control',
        'device:terminal',
        'device:file_transfer',
        'device:update',
        'device:provision',
        'device:unlock',
        'user:read',
        'user:invite',
        'user:role:update',
        'user:remove',
        'grant:create',
        'grant:revoke',
        'session:start',
        'session:view',
        'session:terminate',
        'audit:read',
        'org:update',
        'org:delete',
      ]);
      setError(null);
    } catch (err) {
      setError(err.message || 'failed to load grants');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [orgId]);

  const handleTogglePermission = (perm) => {
    setSelectedPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  const handleCreateGrant = async (e) => {
    e.preventDefault();
    if (!selectedUser || selectedPermissions.length === 0) {
      alert('Please select a user and at least one permission.');
      return;
    }

    setSubmitting(true);
    try {
      await api.createGrant(orgId, {
        userId: selectedUser,
        deviceId: selectedDevice || null,
        effect: selectedEffect,
        permissions: selectedPermissions,
      });

      setShowModal(false);
      setSelectedPermissions([]);
      await loadData();
    } catch (err) {
      alert(err.message || 'Failed to create grant');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeGrant = async (grant) => {
    if (!window.confirm(`Revoke grant for ${grant.user_id}?`)) return;

    try {
      await api.revokeGrant(orgId, grant.id);
      await loadData();
    } catch (err) {
      alert(err.message || 'Failed to revoke grant');
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Access Grants</h2>
        <Action
          permission="grant:create"
          permissions={orgPermissions}
          data-testid="new-grant"
          className="btn btn-primary"
          onClick={() => {
            if (users.length > 0 && !selectedUser) setSelectedUser(users[0].user_id || users[0].id);
            setShowModal(true);
          }}
        >
          New Grant
        </Action>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <p>Loading grants…</p>
      ) : grants.length === 0 ? (
        <div data-testid="grants-empty" className="empty-state">
          No explicit grants configured for this organization.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Grantee</th>
              <th>Target</th>
              <th>Permissions</th>
              <th>Effect</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {grants.map((grant) => (
              <tr
                key={grant.id}
                data-testid="grant-row"
                data-grant-id={grant.id}
                data-effect={grant.effect}
              >
                <td>
                  <strong>{grant.user_id}</strong>
                </td>
                <td>
                  <span>{grant.device_id || 'Org-wide'}</span>
                </td>
                <td>
                  {Array.isArray(grant.permissions) ? (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {grant.permissions.map((p) => (
                        <code key={p}>{p}</code>
                      ))}
                    </div>
                  ) : (
                    <code>{grant.permission || grant.permissions}</code>
                  )}
                </td>
                <td>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      backgroundColor: grant.effect === 'allow' ? '#dcfce7' : '#fee2e2',
                      color: grant.effect === 'allow' ? '#15803d' : '#b91c1c',
                    }}
                  >
                    {grant.effect.toUpperCase()}
                  </span>
                </td>
                <td>
                  <Action
                    permission="grant:revoke"
                    permissions={orgPermissions}
                    data-testid="revoke-grant"
                    className="btn btn-danger"
                    onClick={() => handleRevokeGrant(grant)}
                  >
                    Revoke
                  </Action>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Create Access Grant</h3>
            <form onSubmit={handleCreateGrant}>
              <div className="form-group">
                <label className="form-label" htmlFor="grant-user">
                  User
                </label>
                <select
                  id="grant-user"
                  data-testid="grant-user"
                  className="select"
                  value={selectedUser}
                  onChange={(e) => setSelectedUser(e.target.value)}
                  required
                >
                  <option value="">Select a user</option>
                  {users.map((u) => {
                    const uid = u.user_id || u.id;
                    return (
                      <option key={uid} value={uid}>
                        {u.name || u.email} ({u.role || uid})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="grant-device">
                  Scope (Target Device or Org-Wide)
                </label>
                <select
                  id="grant-device"
                  data-testid="grant-device"
                  className="select"
                  value={selectedDevice}
                  onChange={(e) => setSelectedDevice(e.target.value)}
                >
                  <option value="">(None / Entire Organization)</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.kind} - {d.id})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="grant-effect">
                  Effect
                </label>
                <select
                  id="grant-effect"
                  data-testid="grant-effect"
                  className="select"
                  value={selectedEffect}
                  onChange={(e) => setSelectedEffect(e.target.value)}
                >
                  <option value="allow">allow</option>
                  <option value="deny">deny</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Permissions</label>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                    gap: 8,
                    maxHeight: 180,
                    overflowY: 'auto',
                    border: '1px solid #cbd5e1',
                    padding: 8,
                    borderRadius: 6,
                  }}
                >
                  {availablePermissions.map((perm) => (
                    <label
                      key={perm}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        data-permission-key={perm}
                        checked={selectedPermissions.includes(perm)}
                        onChange={() => handleTogglePermission(perm)}
                      />
                      <span>{perm}</span>
                    </label>
                  ))}
                </div>
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
                  data-testid="grant-submit"
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting}
                >
                  {submitting ? 'Creating…' : 'Create Grant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
