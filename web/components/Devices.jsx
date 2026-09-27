import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { Action } from './Action.jsx';

export function Devices({ orgId, orgPermissions, onStartSession }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newDeviceName, setNewDeviceName] = useState('');
  const [newDeviceKind, setNewDeviceKind] = useState('macos');

  const loadDevices = async () => {
    try {
      setLoading(true);
      const data = await api.getDevices(orgId);
      setDevices(data.devices || []);
      setError(null);
    } catch (err) {
      setError(err.message || 'failed to load devices');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDevices();
  }, [orgId]);

  const handleAddDevice = async (e) => {
    e.preventDefault();
    if (!newDeviceName.trim()) return;

    try {
      await api.provisionDevice(orgId, newDeviceName.trim(), newDeviceKind);
      setShowAddModal(false);
      setNewDeviceName('');
      loadDevices();
    } catch (err) {
      alert(err.message || 'failed to add device');
    }
  };

  const handleRename = async (device) => {
    const nextName = window.prompt('New device name:', device.name);
    if (!nextName || nextName.trim() === device.name) return;

    try {
      await api.updateDevice(orgId, device.id, { name: nextName.trim() });
      loadDevices();
    } catch (err) {
      alert(err.message || 'failed to rename device');
    }
  };

  const handleDecommission = async (device) => {
    if (!window.confirm(`Decommission device "${device.name}"?`)) return;

    try {
      await api.decommissionDevice(orgId, device.id);
      loadDevices();
    } catch (err) {
      alert(err.message || 'failed to decommission device');
    }
  };

  const handleStartSession = async (device, mode) => {
    try {
      await api.startSession(orgId, device.id, mode);
      if (onStartSession) onStartSession();
      alert(`Started ${mode} session on ${device.name}`);
    } catch (err) {
      alert(`Could not start session: ${err.message}`);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Devices</h2>
        <Action
          permission="device:provision"
          permissions={orgPermissions}
          data-testid="add-device"
          className="btn btn-primary"
          onClick={() => setShowAddModal(true)}
        >
          Add Device
        </Action>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <p>Loading devices…</p>
      ) : devices.length === 0 ? (
        <div data-testid="devices-empty" className="empty-state">
          No devices enrolled in this organization yet.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => (
              <tr
                key={device.id}
                data-testid="device-row"
                data-device-id={device.id}
              >
                <td>
                  <strong>{device.name}</strong>
                </td>
                <td style={{ textTransform: 'capitalize' }}>{device.kind}</td>
                <td>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: device.online ? '#34d399' : '#94a3b8',
                      marginRight: 6,
                    }}
                  />
                  {device.online ? 'Online' : 'Offline'}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Action
                      permission="device:view"
                      permissions={device.permissions}
                      data-testid="start-view"
                      className="btn btn-secondary"
                      onClick={() => handleStartSession(device, 'view')}
                    >
                      View
                    </Action>

                    <Action
                      permission="device:control"
                      permissions={device.permissions}
                      data-testid="start-control"
                      className="btn btn-secondary"
                      onClick={() => handleStartSession(device, 'control')}
                    >
                      Control
                    </Action>

                    <Action
                      permission="device:terminal"
                      permissions={device.permissions}
                      data-testid="start-terminal"
                      className="btn btn-secondary"
                      onClick={() => handleStartSession(device, 'terminal')}
                    >
                      Terminal
                    </Action>

                    <Action
                      permission="device:file_transfer"
                      permissions={device.permissions}
                      data-testid="transfer-files"
                      className="btn btn-secondary"
                      onClick={() => alert(`File transfer on ${device.name}`)}
                    >
                      Files
                    </Action>

                    <Action
                      permission="device:update"
                      permissions={device.permissions}
                      data-testid="rename-device"
                      className="btn btn-secondary"
                      onClick={() => handleRename(device)}
                    >
                      Rename
                    </Action>

                    <Action
                      permission="device:provision"
                      permissions={device.permissions}
                      data-testid="decommission-device"
                      className="btn btn-danger"
                      onClick={() => handleDecommission(device)}
                    >
                      Decommission
                    </Action>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showAddModal && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3 className="card-title" style={{ marginBottom: 16 }}>
              Enroll New Device
            </h3>
            <form onSubmit={handleAddDevice}>
              <div className="form-group">
                <label className="form-label">Device Name</label>
                <input
                  type="text"
                  className="input"
                  value={newDeviceName}
                  onChange={(e) => setNewDeviceName(e.target.value)}
                  placeholder="e.g. lab-mac-02"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Platform / Kind</label>
                <select
                  className="select"
                  value={newDeviceKind}
                  onChange={(e) => setNewDeviceKind(e.target.value)}
                >
                  <option value="macos">macOS</option>
                  <option value="windows">Windows</option>
                  <option value="linux">Linux</option>
                  <option value="android">Android</option>
                  <option value="ios">iOS</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Enroll Device
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
