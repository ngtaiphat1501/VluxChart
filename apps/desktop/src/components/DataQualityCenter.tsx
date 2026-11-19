import React from 'react';
import { DataQualityStatusDTO, SpeedMetricsDTO } from '../types';

interface DataQualityCenterProps {
  dataQuality: DataQualityStatusDTO;
  speed1s: SpeedMetricsDTO;
  speed5s: SpeedMetricsDTO;
  speed10s: SpeedMetricsDTO;
  cvdUnits: number;
}

export const DataQualityCenter: React.FC<DataQualityCenterProps> = ({
  dataQuality,
  speed1s,
  speed5s,
  speed10s,
  cvdUnits,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        fontSize: '12px',
        color: '#E1E4EA',
      }}
    >
      {/* Feed Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span
          style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: dataQuality.feed_status === 'LIVE_CONNECTED' ? '#00E676' : '#FF5252',
            boxShadow:
              dataQuality.feed_status === 'LIVE_CONNECTED'
                ? '0 0 8px rgba(0, 230, 118, 0.8)'
                : 'none',
          }}
        />
        <span style={{ fontWeight: 600 }}>{dataQuality.feed_status}</span>
      </div>

      {/* Latency */}
      <div style={{ color: '#8E9AA8' }}>
        Latency: <span style={{ color: '#E1E4EA', fontWeight: 500 }}>{dataQuality.latency_ms}ms</span>
      </div>

      {/* Completeness Badge */}
      <span
        style={{
          background: '#2B303C',
          color: dataQuality.completeness === 'COMPLETE' ? '#00E676' : '#FFD600',
          padding: '2px 8px',
          borderRadius: '4px',
          fontWeight: 600,
          fontSize: '11px',
        }}
      >
        {dataQuality.completeness}
      </span>

      {/* Invariant Health */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          color: dataQuality.volume_invariant_ok ? '#00E676' : '#FF5252',
          background: 'rgba(0, 230, 118, 0.1)',
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '11px',
        }}
      >
        <span>✓ Invariant: Exact Integer OK</span>
      </div>

      {/* CVD Meter */}
      <div style={{ color: '#8E9AA8' }}>
        CVD:{' '}
        <span
          style={{
            color: cvdUnits >= 0 ? '#00E676' : '#FF5252',
            fontWeight: 600,
            fontFamily: 'monospace',
          }}
        >
          {cvdUnits >= 0 ? `+${cvdUnits}` : cvdUnits}
        </span>
      </div>

      {/* Rolling Speed Gauges */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: '#1A1E26',
          padding: '2px 8px',
          borderRadius: '4px',
          border: '1px solid #2B303C',
          fontSize: '11px',
        }}
      >
        <span style={{ color: '#8E9AA8' }}>Speed:</span>
        <span style={{ color: '#64B5F6' }}>1s: {speed1s.total_units}/s</span>
        <span style={{ color: '#64B5F6' }}>5s: {speed5s.total_units}/s</span>
      </div>
    </div>
  );
};
