import React, { useState } from 'react';
import { api } from '../api.js';
import { Action } from './Action.jsx';

export function Admin({ org, orgPermissions, onOrgUpdated, onOrgDeleted }) {
  const [error, setError] = useState(null);

  const handleRename = async () => {
    const nextName = window.prompt('New organization name:', org.name);
    if (!nextName || nextName.trim() === org.name) return;

    try {
      const updated = await api.updateOrg(org.id, { name: nextName.trim() });
      if (onOrgUpdated) onOrgUpdated(updated.organization || updated);
    } catch (err) {
      setError(err.message || 'failed to rename organization');
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Are you absolutely sure you want to delete organization "${org.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      await api.deleteOrg(org.id);
      if (onOrgDeleted) onOrgDeleted(org.id);
    } catch (err) {
      setError(err.message || 'failed to delete organization');
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Organization Administration</h2>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div style={{ marginBottom: 24 }}>
        <p style={{ color: '#475569', marginBottom: 12 }}>
          Manage organization settings, lifecycle, and administrative functions for <strong>{org.name}</strong> (<code>{org.id}</code>).
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <div>
            <strong>Rename Organization</strong>
            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>Update the display name of this organization.</p>
          </div>
          <Action
            permission="org:update"
            permissions={orgPermissions}
            data-testid="rename-org"
            className="btn btn-secondary"
            onClick={handleRename}
          >
            Rename Organization
          </Action>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, border: '1px solid #fee2e2', borderRadius: 8, backgroundColor: '#fff5f5' }}>
          <div>
            <strong style={{ color: '#b91c1c' }}>Delete Organization</strong>
            <p style={{ fontSize: '0.85rem', color: '#7f1d1d', margin: 0 }}>Permanently remove this organization and all its resources.</p>
          </div>
          <Action
            permission="org:delete"
            permissions={orgPermissions}
            data-testid="delete-org"
            className="btn btn-danger"
            onClick={handleDelete}
          >
            Delete Organization
          </Action>
        </div>
      </div>
    </div>
  );
}
