import React, { useState } from 'react';

export interface OrderFlowAlert {
  id: string;
  timestamp: Date;
  type: 'Whale' | 'StackedImbalance' | 'Absorption' | 'Exhaustion' | 'Divergence' | 'Iceberg';
  title: string;
  priceTicks: number;
  details: string;
}

interface AlertCenterProps {
  alerts: OrderFlowAlert[];
  onClearAlerts: () => void;
}

export const AlertNotificationCenter: React.FC<AlertCenterProps> = ({ alerts, onClearAlerts }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<'All' | 'Whale' | 'StackedImbalance' | 'Divergence'>('All');

  const filteredAlerts = alerts.filter((a) => {
    if (filter === 'All') return true;
    return a.type === filter;
  });

  const getBadgeColor = (type: string) => {
    switch (type) {
      case 'Whale':
        return '#FF9100'; // Amber
      case 'StackedImbalance':
        return '#00E676'; // Emerald
      case 'Absorption':
        return '#AB47BC'; // Purple
      case 'Exhaustion':
        return '#F59E0B'; // Amber
      case 'Divergence':
        return '#38BDF8'; // Steel-Cyan
      case 'Iceberg':
        return '#2DD4BF'; // Teal
      default:
        return '#8E9AA8';
    }
  };

  return (
    <>
      {/* Drawer Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: alerts.length > 0 ? '#1C2632' : '#1A1D24',
          color: alerts.length > 0 ? '#34D399' : '#8E9AA8',
          border: '1px solid #2D3648',
          borderRadius: '4px',
          padding: '4px 10px',
          fontSize: '11px',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
        title="View Real-Time Order Flow Alerts"
      >
        <span>Alerts</span>
        {alerts.length > 0 && (
          <span
            style={{
              background: '#00E676',
              color: '#121418',
              borderRadius: '8px',
              padding: '1px 5px',
              fontSize: '10px',
              fontWeight: 700,
            }}
          >
            {alerts.length}
          </span>
        )}
      </button>

      {/* Floating Slide-out Drawer */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            top: '48px',
            right: '16px',
            width: '360px',
            maxHeight: '480px',
            background: '#1A1D24',
            border: '1px solid #3F4656',
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '10px 14px',
              background: '#252932',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid #2B303C',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#FFF' }}>
                Order Flow Live Alerts
              </span>
              <span style={{ fontSize: '11px', color: '#8E9AA8' }}>({filteredAlerts.length})</span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={onClearAlerts}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#8E9AA8',
                  fontSize: '11px',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Clear
              </button>
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#FFF',
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Filter Bar */}
          <div
            style={{
              padding: '6px 12px',
              background: '#161920',
              display: 'flex',
              gap: '4px',
              borderBottom: '1px solid #2B303C',
            }}
          >
            {(['All', 'Whale', 'StackedImbalance', 'Divergence'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  background: filter === f ? '#3F4656' : 'transparent',
                  color: filter === f ? '#FFF' : '#8E9AA8',
                  border: 'none',
                  borderRadius: '3px',
                  padding: '2px 8px',
                  fontSize: '10px',
                  fontWeight: filter === f ? 700 : 400,
                  cursor: 'pointer',
                }}
              >
                {f === 'StackedImbalance' ? 'Stacks' : f}
              </button>
            ))}
          </div>

          {/* Alerts List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {filteredAlerts.length === 0 ? (
              <div
                style={{
                  padding: '24px',
                  textAlign: 'center',
                  color: '#8E9AA8',
                  fontSize: '12px',
                }}
              >
                No alerts detected yet. Waiting for market action...
              </div>
            ) : (
              filteredAlerts.map((alert) => (
                <div
                  key={alert.id}
                  style={{
                    background: '#252932',
                    padding: '8px 10px',
                    borderRadius: '5px',
                    marginBottom: '6px',
                    borderLeft: `3px solid ${getBadgeColor(alert.type)}`,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '3px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 700,
                        color: getBadgeColor(alert.type),
                        textTransform: 'uppercase',
                      }}
                    >
                      {alert.type}
                    </span>
                    <span style={{ fontSize: '10px', color: '#8E9AA8' }}>
                      {alert.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#FFF', fontWeight: 600 }}>
                    {alert.title} @ {(alert.priceTicks / 100).toFixed(2)}
                  </div>
                  <div style={{ fontSize: '10px', color: '#B0BEC5', marginTop: '2px' }}>
                    {alert.details}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
};
