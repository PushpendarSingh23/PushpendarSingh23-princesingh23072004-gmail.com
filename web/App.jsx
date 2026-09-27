import React, { useState, useEffect } from 'react';
import { api, setAccessToken } from './api.js';
import { Login } from './components/Login.jsx';
import { AcceptInvite } from './components/AcceptInvite.jsx';
import { Devices } from './components/Devices.jsx';
import { People } from './components/People.jsx';
import { Grants } from './components/Grants.jsx';
import { Sessions } from './components/Sessions.jsx';
import { Audit } from './components/Audit.jsx';
import { Admin } from './components/Admin.jsx';
import { Action } from './components/Action.jsx';

function isAllowed(permissions, key) {
  const perm = permissions?.[key];
  return typeof perm === 'boolean' ? perm : perm?.effect === 'allow';
}

export function App() {
  const [user, setUser] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [activeOrgId, setActiveOrgId] = useState(null);
  const [orgPermissions, setOrgPermissions] = useState({});
  const [activeRole, setActiveRole] = useState('');
  const [activeTab, setActiveTab] = useState('devices');
  const [loading, setLoading] = useState(true);
  const [inviteToken, setInviteToken] = useState(null);

  // Check URL route for invite redemption or restore session on reload
  useEffect(() => {
    const path = window.location.pathname;
    const inviteMatch = path.match(/^\/invite\/([a-zA-Z0-9_-]+)$/);
    if (inviteMatch) {
      setInviteToken(inviteMatch[1]);
      setLoading(false);
      return;
    }

    async function restoreSession() {
      try {
        const refreshData = await api.refresh();
        if (refreshData?.token) {
          setAccessToken(refreshData.token);
          const me = await api.getMe();
          setUser(me.user);
          setOrgs(me.orgs || []);
          setActiveOrgId(me.org?.id || me.orgs?.[0]?.id);
          setActiveRole(me.role || '');
          setOrgPermissions(me.permissions || {});
        }
      } catch (err) {
        // No valid session cookie, remain on Login
      } finally {
        setLoading(false);
      }
    }
    restoreSession();
  }, []);

  const handleLoginSuccess = (data) => {
    setAccessToken(data.token);
    setUser(data.user);
    setOrgs(data.orgs || []);
    setActiveOrgId(data.org?.id || data.orgs?.[0]?.id);
    setActiveRole(data.role || '');
    setOrgPermissions(data.permissions || {});
  };

  const selectOrg = async (orgId) => {
    try {
      const data = await api.switchOrg(orgId);
      setAccessToken(data.token);
      setActiveOrgId(data.org.id);
      setActiveRole(data.role);
      setOrgPermissions(data.permissions || {});
    } catch (err) {
      console.error('Failed to switch org:', err);
    }
  };

  const handleCreateOrg = async () => {
    const orgName = window.prompt('Enter new organization name:');
    if (!orgName || !orgName.trim()) return;

    try {
      await api.createOrg(orgName.trim());
      const me = await api.getMe();
      setOrgs(me.orgs || []);
      const createdOrg = (me.orgs || []).find((o) => o.name === orgName.trim()) || me.orgs?.[me.orgs.length - 1];
      if (createdOrg) {
        await selectOrg(createdOrg.id);
      }
      setActiveTab('devices');
    } catch (err) {
      alert(err.message || 'Failed to create organization');
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout?.();
    } catch (e) {
      // ignore
    }
    setAccessToken(null);
    setUser(null);
    setOrgs([]);
    setActiveOrgId(null);
  };

  if (loading) {
    return (
      <div className="auth-container">
        <p>Loading RemoteOps…</p>
      </div>
    );
  }

  if (inviteToken) {
    return (
      <AcceptInvite
        token={inviteToken}
        onAccepted={() => {
          window.history.pushState({}, '', '/');
          setInviteToken(null);
        }}
      />
    );
  }

  if (!user) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  const activeOrg = orgs.find((o) => o.id === activeOrgId) || orgs[0] || { id: '', name: '', theme: 'cobalt' };

  const canDevices = isAllowed(orgPermissions, 'device:list');
  const canPeople = isAllowed(orgPermissions, 'user:read');
  const canGrants = isAllowed(orgPermissions, 'user:read') || isAllowed(orgPermissions, 'grant:create') || isAllowed(orgPermissions, 'grant:revoke');
  const canSessions = isAllowed(orgPermissions, 'session:start') || isAllowed(orgPermissions, 'session:view') || isAllowed(orgPermissions, 'session:terminate');
  const canAudit = isAllowed(orgPermissions, 'audit:read');
  const canAdmin = isAllowed(orgPermissions, 'org:update') || isAllowed(orgPermissions, 'org:delete');

  return (
    <div
      data-testid="app-shell"
      data-org-id={activeOrg.id}
      data-org-theme={activeOrg.theme || 'cobalt'}
      className="app-shell"
    >
      <header className="header-bar">
        <div className="brand-section">
          <span className="brand-title">RemoteOps</span>
          <div className="org-switcher-section">
            {orgs.map((org) => (
              <button
                key={org.id}
                data-testid="org-option"
                data-org-id={org.id}
                className={`btn ${org.id === activeOrg.id ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '0.85rem', padding: '4px 10px' }}
                onClick={() => selectOrg(org.id)}
              >
                {org.name}
              </button>
            ))}
            <button
              data-testid="create-org"
              className="btn btn-secondary"
              style={{ fontSize: '0.85rem', padding: '4px 10px' }}
              onClick={handleCreateOrg}
            >
              + New Org
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem' }}>
            <span style={{ color: 'rgba(255,255,255,0.7)' }}>Role:</span>
            <span data-testid="active-role" className="role-badge">
              {activeRole || 'viewer'}
            </span>
          </div>

          <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)' }}>
            {user.name} ({user.email})
          </div>

          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem', padding: '3px 8px', color: '#fff' }}
            onClick={handleLogout}
          >
            Sign out
          </button>
        </div>
      </header>

      <nav className="nav-bar">
        {canDevices && (
          <button
            data-testid="nav-devices"
            data-permission="device:list"
            data-state="unlocked"
            className={`nav-tab ${activeTab === 'devices' ? 'active' : ''}`}
            onClick={() => setActiveTab('devices')}
          >
            Devices
          </button>
        )}

        {canPeople && (
          <button
            data-testid="nav-people"
            data-permission="user:read"
            data-state="unlocked"
            className={`nav-tab ${activeTab === 'people' ? 'active' : ''}`}
            onClick={() => setActiveTab('people')}
          >
            People
          </button>
        )}

        {canGrants && (
          <button
            data-testid="nav-grants"
            data-permission="grant:create"
            data-state="unlocked"
            className={`nav-tab ${activeTab === 'grants' ? 'active' : ''}`}
            onClick={() => setActiveTab('grants')}
          >
            Grants
          </button>
        )}

        {canSessions && (
          <button
            data-testid="nav-sessions"
            data-permission="session:view"
            data-state="unlocked"
            className={`nav-tab ${activeTab === 'sessions' ? 'active' : ''}`}
            onClick={() => setActiveTab('sessions')}
          >
            Sessions
          </button>
        )}

        {canAudit && (
          <button
            data-testid="nav-audit"
            data-permission="audit:read"
            data-state="unlocked"
            className={`nav-tab ${activeTab === 'audit' ? 'active' : ''}`}
            onClick={() => setActiveTab('audit')}
          >
            Audit
          </button>
        )}

        {canAdmin && (
          <button
            data-testid="nav-admin"
            data-permission="org:update"
            data-state="unlocked"
            className={`nav-tab ${activeTab === 'admin' ? 'active' : ''}`}
            onClick={() => setActiveTab('admin')}
          >
            Admin
          </button>
        )}
      </nav>

      <main className="main-content">
        {activeTab === 'devices' && (
          <Devices
            orgId={activeOrg.id}
            orgPermissions={orgPermissions}
            onStartSession={() => setActiveTab('sessions')}
          />
        )}
        {activeTab === 'people' && (
          <People
            orgId={activeOrg.id}
            orgPermissions={orgPermissions}
            currentUser={user}
          />
        )}
        {activeTab === 'grants' && (
          <Grants
            orgId={activeOrg.id}
            orgPermissions={orgPermissions}
          />
        )}
        {activeTab === 'sessions' && (
          <Sessions
            orgId={activeOrg.id}
            orgPermissions={orgPermissions}
            currentUser={user}
          />
        )}
        {activeTab === 'audit' && (
          <Audit
            orgId={activeOrg.id}
          />
        )}
        {activeTab === 'admin' && (
          <Admin
            org={activeOrg}
            orgPermissions={orgPermissions}
            onOrgUpdated={(updated) => {
              setOrgs((prev) => prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)));
            }}
            onOrgDeleted={(deletedId) => {
              const remaining = orgs.filter((o) => o.id !== deletedId);
              setOrgs(remaining);
              if (remaining.length > 0) {
                selectOrg(remaining[0].id);
              }
            }}
          />
        )}
      </main>
    </div>
  );
}
