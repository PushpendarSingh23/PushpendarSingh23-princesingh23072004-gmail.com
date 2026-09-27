// Memory-only access token storage — never in localStorage or sessionStorage (D13)
let inMemoryToken = null;

export function getAccessToken() {
  return inMemoryToken;
}

export function setAccessToken(token) {
  inMemoryToken = token;
}

export function clearAccessToken() {
  inMemoryToken = null;
}

export async function request(path, options = {}) {
  const headers = { ...options.headers };

  if (inMemoryToken && !headers.authorization && !headers.Authorization) {
    headers.authorization = `Bearer ${inMemoryToken}`;
  }

  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['content-type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(path, {
    credentials: 'include',
    ...options,
    headers,
  });

  const contentType = res.headers.get('content-type') || '';
  let data = null;

  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  if (!res.ok) {
    const error = new Error(data?.error?.message || 'Request failed');
    error.status = res.status;
    error.code = data?.error?.code || 'ERROR';
    error.reason = data?.error?.reason || null;
    error.requestId = data?.error?.requestId || null;
    throw error;
  }

  return data;
}

export const api = {
  login: (email, password, orgId) =>
    request('/v1/auth/login', {
      method: 'POST',
      body: { email, password, ...(orgId ? { orgId } : {}) },
    }),

  refresh: () =>
    request('/v1/auth/refresh', {
      method: 'POST',
    }),

  switchOrg: (orgId) =>
    request('/v1/auth/token', {
      method: 'POST',
      body: { orgId },
    }),

  getMe: () => request('/v1/auth/me'),

  getOrgs: () => request('/v1/orgs'),

  createOrg: (name, theme = 'cobalt') =>
    request('/v1/orgs', {
      method: 'POST',
      body: { name, theme },
    }),

  updateOrg: (orgId, updates) =>
    request(`/v1/orgs/${orgId}`, {
      method: 'PATCH',
      body: updates,
    }),

  deleteOrg: (orgId) =>
    request(`/v1/orgs/${orgId}`, {
      method: 'DELETE',
    }),

  getMembers: (orgId) => request(`/v1/orgs/${orgId}/members`),
  getUsers: (orgId) => request(`/v1/orgs/${orgId}/members`),

  updateMemberRole: (orgId, userId, role) =>
    request(`/v1/orgs/${orgId}/members/${userId}`, {
      method: 'PATCH',
      body: { role },
    }),

  suspendMember: (orgId, userId) =>
    request(`/v1/orgs/${orgId}/members/${userId}/suspend`, {
      method: 'POST',
    }),

  reinstateMember: (orgId, userId) =>
    request(`/v1/orgs/${orgId}/members/${userId}/suspend`, {
      method: 'DELETE',
    }),

  removeMember: (orgId, userId) =>
    request(`/v1/orgs/${orgId}/members/${userId}`, {
      method: 'DELETE',
    }),

  leaveOrg: (orgId) =>
    request(`/v1/orgs/${orgId}/members/me`, {
      method: 'DELETE',
    }),

  getInvites: (orgId) => request(`/v1/orgs/${orgId}/invites`),

  createInvite: (orgId, email, role) =>
    request(`/v1/orgs/${orgId}/invites`, {
      method: 'POST',
      body: { email, role },
    }),

  revokeInvite: (orgId, inviteId) =>
    request(`/v1/orgs/${orgId}/invites/${inviteId}`, {
      method: 'DELETE',
    }),

  peekInvite: (token) => request(`/v1/invites/${token}`),

  acceptInvite: (token, name, password) =>
    request(`/v1/invites/${token}/accept`, {
      method: 'POST',
      body: { name, password },
    }),

  getDevices: (orgId) => request(`/v1/orgs/${orgId}/devices`),

  getDevice: (orgId, deviceId) => request(`/v1/orgs/${orgId}/devices/${deviceId}`),

  provisionDevice: (orgId, name, kind) =>
    request(`/v1/orgs/${orgId}/devices`, {
      method: 'POST',
      body: { name, kind },
    }),

  updateDevice: (orgId, deviceId, updates) =>
    request(`/v1/orgs/${orgId}/devices/${deviceId}`, {
      method: 'PATCH',
      body: updates,
    }),

  decommissionDevice: (orgId, deviceId) =>
    request(`/v1/orgs/${orgId}/devices/${deviceId}`, {
      method: 'DELETE',
    }),

  transferDevice: (orgId, deviceId, targetOrgId) =>
    request(`/v1/orgs/${orgId}/devices/${deviceId}/transfer`, {
      method: 'POST',
      body: { targetOrgId },
    }),

  getGrants: (orgId) => request(`/v1/orgs/${orgId}/grants`),

  createGrant: (orgId, grantData) =>
    request(`/v1/orgs/${orgId}/grants`, {
      method: 'POST',
      body: grantData,
    }),

  revokeGrant: (orgId, grantId) =>
    request(`/v1/orgs/${orgId}/grants/${grantId}`, {
      method: 'DELETE',
    }),

  getSessions: (orgId) => request(`/v1/orgs/${orgId}/sessions`),

  getSession: (sessionId) => request(`/v1/sessions/${sessionId}`),

  startSession: (orgId, deviceId, mode) =>
    request(`/v1/orgs/${orgId}/sessions`, {
      method: 'POST',
      body: { deviceId, mode },
    }),

  stopSession: (sessionId) =>
    request(`/v1/sessions/${sessionId}`, {
      method: 'DELETE',
    }),
  terminateSession: (orgId, sessionId) =>
    request(`/v1/sessions/${sessionId}`, {
      method: 'DELETE',
    }),

  getAudit: (orgId, limit = 50, offset = 0) =>
    request(`/v1/orgs/${orgId}/audit?limit=${limit}&offset=${offset}`),
  getAuditEvents: (orgId, limit = 50, offset = 0) =>
    request(`/v1/orgs/${orgId}/audit?limit=${limit}&offset=${offset}`),
};
