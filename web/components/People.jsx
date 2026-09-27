import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { Action } from './Action.jsx';

export function People({ orgId, orgPermissions, callerUserId }) {
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [createdInviteToken, setCreatedInviteToken] = useState(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const [membersData, invitesData] = await Promise.all([
        api.getMembers(orgId),
        orgPermissions?.['user:invite']?.effect === 'allow'
          ? api.getInvites(orgId).catch(() => ({ invites: [] }))
          : Promise.resolve({ invites: [] }),
      ]);
      setMembers(membersData.members || []);
      setInvites(invitesData.invites || []);
      setError(null);
    } catch (err) {
      setError(err.message || 'failed to load members');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [orgId, orgPermissions]);

  const handleRoleChange = async (userId, newRole) => {
    try {
      await api.updateMemberRole(orgId, userId, newRole);
      loadData();
    } catch (err) {
      alert(err.message || 'failed to change role');
    }
  };

  const handleToggleSuspend = async (member) => {
    const isSuspended = member.status === 'suspended';
    try {
      if (isSuspended) {
        await api.reinstateMember(orgId, member.user_id);
      } else {
        await api.suspendMember(orgId, member.user_id);
      }
      loadData();
    } catch (err) {
      alert(err.message || 'failed to update suspension');
    }
  };

  const handleRemove = async (member) => {
    if (!window.confirm(`Remove member "${member.name || member.email}"?`)) return;

    try {
      await api.removeMember(orgId, member.user_id);
      loadData();
    } catch (err) {
      alert(err.message || 'failed to remove member');
    }
  };

  const handleCreateInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    try {
      const data = await api.createInvite(orgId, inviteEmail.trim(), inviteRole);
      setCreatedInviteToken(data.inviteToken);
      setInviteEmail('');
      loadData();
    } catch (err) {
      alert(err.message || 'failed to create invite');
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">People & Members</h2>
        <Action
          permission="user:invite"
          permissions={orgPermissions}
          data-testid="invite-user"
          className="btn btn-primary"
          onClick={() => {
            setCreatedInviteToken(null);
            setShowInviteModal(true);
          }}
        >
          Invite Member
        </Action>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <p>Loading people…</p>
      ) : (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr
                  key={member.id}
                  data-testid="user-row"
                  data-user-id={member.user_id}
                >
                  <td>
                    <strong>{member.name}</strong>
                    {member.user_id === callerUserId && ' (You)'}
                  </td>
                  <td>{member.email}</td>
                  <td>
                    {orgPermissions?.['user:role:update']?.effect === 'allow' &&
                    member.user_id !== callerUserId ? (
                      <Action
                        permission="user:role:update"
                        permissions={orgPermissions}
                        component="select"
                        data-testid="role-select"
                        className="select"
                        style={{ width: 'auto', padding: '4px 8px' }}
                        value={member.role}
                        onChange={(e) => handleRoleChange(member.user_id, e.target.value)}
                      >
                        <option value="owner">Owner</option>
                        <option value="admin">Admin</option>
                        <option value="operator">Operator</option>
                        <option value="auditor">Auditor</option>
                        <option value="viewer">Viewer</option>
                        <option value="reviewer">Reviewer</option>
                      </Action>
                    ) : (
                      <span className="role-badge">{member.role}</span>
                    )}
                  </td>
                  <td>
                    <span
                      style={{
                        padding: '2px 8px',
                        fontSize: 12,
                        borderRadius: 4,
                        background:
                          member.status === 'active'
                            ? 'rgba(52, 211, 153, 0.15)'
                            : member.status === 'suspended'
                            ? 'rgba(239, 68, 68, 0.2)'
                            : 'rgba(148, 163, 184, 0.2)',
                        color:
                          member.status === 'active'
                            ? '#34d399'
                            : member.status === 'suspended'
                            ? '#f87171'
                            : '#94a3b8',
                      }}
                    >
                      {member.status}
                    </span>
                  </td>
                  <td>
                    {member.user_id !== callerUserId && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Action
                          permission="user:remove"
                          permissions={orgPermissions}
                          data-testid="suspend-user"
                          className="btn btn-secondary"
                          onClick={() => handleToggleSuspend(member)}
                        >
                          {member.status === 'suspended' ? 'Reinstate' : 'Suspend'}
                        </Action>

                        <Action
                          permission="user:remove"
                          permissions={orgPermissions}
                          data-testid="remove-user"
                          className="btn btn-danger"
                          onClick={() => handleRemove(member)}
                        >
                          Remove
                        </Action>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {invites.filter((i) => !i.accepted_at && !i.revoked_at).length > 0 && (
            <div style={{ marginTop: 32 }}>
              <h3 className="card-title" style={{ fontSize: 16, marginBottom: 12 }}>
                Pending Invites
              </h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Expires</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {invites
                    .filter((i) => !i.accepted_at && !i.revoked_at)
                    .map((inv) => (
                      <tr key={inv.id}>
                        <td>{inv.email}</td>
                        <td>
                          <span className="role-badge">{inv.role}</span>
                        </td>
                        <td>{new Date(inv.expires_at).toLocaleDateString()}</td>
                        <td>
                          <button
                            className="btn btn-danger"
                            onClick={async () => {
                              await api.revokeInvite(orgId, inv.id);
                              loadData();
                            }}
                          >
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {showInviteModal && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3 className="card-title" style={{ marginBottom: 16 }}>
              Invite New Member
            </h3>

            {createdInviteToken ? (
              <div>
                <p style={{ marginBottom: 12, color: '#34d399' }}>
                  Invite created successfully! Share this link:
                </p>
                <input
                  type="text"
                  className="input"
                  readOnly
                  value={`${window.location.origin}/invite/${createdInviteToken}`}
                  style={{ marginBottom: 16 }}
                  onClick={(e) => e.target.select()}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowInviteModal(false)}
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreateInvite}>
                <div className="form-group">
                  <label className="form-label">Email Address</label>
                  <input
                    type="email"
                    className="input"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@example.test"
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Role</label>
                  <select
                    className="select"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                  >
                    <option value="admin">Admin</option>
                    <option value="operator">Operator</option>
                    <option value="auditor">Auditor</option>
                    <option value="viewer">Viewer</option>
                    <option value="reviewer">Reviewer</option>
                  </select>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowInviteModal(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Create Invite Link
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
