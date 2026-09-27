import React, { useState, useEffect } from 'react';
import { api } from '../api.js';

export function Audit({ orgId }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadAudit() {
      try {
        setLoading(true);
        const data = await api.getAuditEvents(orgId);
        setEvents(data.events || []);
        setError(null);
      } catch (err) {
        setError(err.message || 'failed to load audit events');
      } finally {
        setLoading(false);
      }
    }
    loadAudit();
  }, [orgId]);

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Audit Log</h2>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <p>Loading audit trail…</p>
      ) : events.length === 0 ? (
        <div data-testid="audit-empty" className="empty-state">
          No audit log records recorded yet.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Target</th>
              <th>Result</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <tr
                key={ev.id}
                data-testid="audit-row"
                data-audit-id={ev.id}
              >
                <td style={{ fontSize: '0.85rem', color: '#64748b' }}>
                  {ev.timestamp ? new Date(ev.timestamp * 1000).toLocaleString() : '—'}
                </td>
                <td>
                  <code>{ev.action}</code>
                </td>
                <td>{ev.actorName || ev.actorId || 'system'}</td>
                <td>{ev.targetId || '—'}</td>
                <td>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      backgroundColor: ev.result === 'denied' || ev.result === 'failure' ? '#fee2e2' : '#dcfce7',
                      color: ev.result === 'denied' || ev.result === 'failure' ? '#b91c1c' : '#15803d',
                    }}
                  >
                    {ev.result || 'success'}
                  </span>
                </td>
                <td style={{ fontSize: '0.8rem', color: '#475569' }}>
                  {typeof ev.details === 'object' ? JSON.stringify(ev.details) : ev.details || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
