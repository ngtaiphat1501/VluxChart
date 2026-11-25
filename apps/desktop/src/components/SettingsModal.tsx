import React, { useState } from 'react';
import { FootprintColorMode, HeatmapPalette, WorkspaceConfig } from '../utils/workspaceStorage';
import { SoundManager } from '../utils/soundManager';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: WorkspaceConfig;
  onSaveConfig: (newConfig: Partial<WorkspaceConfig>) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
}) => {
  const [footprintMode, setFootprintMode] = useState<FootprintColorMode>(config.footprintMode || 'bid_ask');
  const [heatmapPalette, setHeatmapPalette] = useState<HeatmapPalette>(config.heatmapPalette || 'fire');
  const [whaleThreshold, setWhaleThreshold] = useState<number>(config.whaleVolumeThreshold || 500);
  const [imbalanceRatio, setImbalanceRatio] = useState<number>(config.imbalanceRatioPct || 300);
  const [minStacked, setMinStacked] = useState<number>(config.minStackedLevels || 3);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(config.soundAlertsEnabled ?? true);

  if (!isOpen) return null;

  const handleSave = () => {
    onSaveConfig({
      footprintMode,
      heatmapPalette,
      whaleVolumeThreshold: whaleThreshold,
      imbalanceRatioPct: imbalanceRatio,
      minStackedLevels: minStacked,
      soundAlertsEnabled: soundEnabled,
    });
    SoundManager.setEnabled(soundEnabled);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(10, 12, 16, 0.85)',
        backdropFilter: 'blur(6px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: '640px',
          background: '#1A1D24',
          border: '1px solid #3F4656',
          borderRadius: '10px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
          overflow: 'hidden',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#E1E4EA',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #2B303C',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#161920',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#F8FAFC' }}>
                Terminal Workspace &amp; Theme Settings
              </h2>
              <p style={{ margin: '2px 0 0 0', fontSize: '11.5px', color: '#8E9AA8' }}>
                Custom Footprint Colors, Heatmap Palettes &amp; Order Flow Thresholds
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#8E9AA8',
              fontSize: '20px',
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Settings Body */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto' }}>
          {/* Section 1: Footprint & Heatmap Display Themes */}
          <div>
            <h4 style={{ margin: '0 0 12px 0', fontSize: '12px', fontWeight: 700, color: '#38BDF8', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              1. Chart Aesthetics &amp; Palettes
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '11px', color: '#8E9AA8', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  FOOTPRINT COLORING MODE
                </label>
                <select
                  value={footprintMode}
                  onChange={(e) => setFootprintMode(e.target.value as FootprintColorMode)}
                  style={{
                    width: '100%',
                    background: '#252932',
                    color: '#FFF',
                    border: '1px solid #3F4656',
                    borderRadius: '4px',
                    padding: '8px',
                    fontSize: '12px',
                  }}
                >
                  <option value="bid_ask">Bid × Ask Imbalance (Green/Red)</option>
                  <option value="delta_gradient">Delta Gradient (Blue/Orange)</option>
                  <option value="monochrome">High-Contrast Monochrome</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '11px', color: '#8E9AA8', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  BOOKMAP HEATMAP PALETTE
                </label>
                <select
                  value={heatmapPalette}
                  onChange={(e) => setHeatmapPalette(e.target.value as HeatmapPalette)}
                  style={{
                    width: '100%',
                    background: '#252932',
                    color: '#FFF',
                    border: '1px solid #3F4656',
                    borderRadius: '4px',
                    padding: '8px',
                    fontSize: '12px',
                  }}
                >
                  <option value="fire">Classic Bookmap Fire (Black-Orange-White)</option>
                  <option value="neon">Cyberpunk Ice (Deep Blue-Cyan-White)</option>
                  <option value="greyscale">Radar Greyscale (Dark-Light Gray)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 2: Order Flow Detection Thresholds */}
          <div>
            <h4 style={{ margin: '0 0 12px 0', fontSize: '12px', fontWeight: 700, color: '#38BDF8', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              2. Institutional Detection Thresholds
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '11px', color: '#8E9AA8', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  WHALE ACCUMULATION CUTOFF
                </label>
                <input
                  type="number"
                  value={whaleThreshold}
                  step={50}
                  min={50}
                  onChange={(e) => setWhaleThreshold(Number(e.target.value))}
                  style={{
                    width: '100%',
                    background: '#252932',
                    color: '#FFF',
                    border: '1px solid #3F4656',
                    borderRadius: '4px',
                    padding: '8px',
                    fontSize: '12px',
                  }}
                />
                <span style={{ fontSize: '10px', color: '#8E9AA8', marginTop: '2px', display: 'block' }}>Default: 500 units</span>
              </div>

              <div>
                <label style={{ fontSize: '11px', color: '#8E9AA8', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  STACKED IMBALANCE RATIO
                </label>
                <input
                  type="number"
                  value={imbalanceRatio}
                  step={25}
                  min={150}
                  onChange={(e) => setImbalanceRatio(Number(e.target.value))}
                  style={{
                    width: '100%',
                    background: '#252932',
                    color: '#FFF',
                    border: '1px solid #3F4656',
                    borderRadius: '4px',
                    padding: '8px',
                    fontSize: '12px',
                  }}
                />
                <span style={{ fontSize: '10px', color: '#8E9AA8', marginTop: '2px', display: 'block' }}>Default: 300% (3.0x)</span>
              </div>

              <div>
                <label style={{ fontSize: '11px', color: '#8E9AA8', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  MIN CONSECUTIVE LEVELS
                </label>
                <input
                  type="number"
                  value={minStacked}
                  min={2}
                  max={10}
                  onChange={(e) => setMinStacked(Number(e.target.value))}
                  style={{
                    width: '100%',
                    background: '#252932',
                    color: '#FFF',
                    border: '1px solid #3F4656',
                    borderRadius: '4px',
                    padding: '8px',
                    fontSize: '12px',
                  }}
                />
                <span style={{ fontSize: '10px', color: '#8E9AA8', marginTop: '2px', display: 'block' }}>Default: 3 levels</span>
              </div>
            </div>
          </div>

          {/* Section 3: Web Audio Synthesizer Cues */}
          <div>
            <h4 style={{ margin: '0 0 12px 0', fontSize: '12px', fontWeight: 700, color: '#38BDF8', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              3. Acoustic Synthesizer Audio Cues
            </h4>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#252932', padding: '12px', borderRadius: '6px' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFF' }}>Master Sound Engine</div>
                <div style={{ fontSize: '11px', color: '#8E9AA8' }}>Low-latency synthetic audio cues for order flow events</div>
              </div>
              <input
                type="checkbox"
                checked={soundEnabled}
                onChange={(e) => setSoundEnabled(e.target.checked)}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => SoundManager.playWhaleChime()}
                style={{
                  background: '#1A1D24',
                  color: '#F59E0B',
                  border: '1px solid #2D3648',
                  borderRadius: '4px',
                  padding: '6px 12px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                ▶ Whale Chime
              </button>
              <button
                type="button"
                onClick={() => SoundManager.playIcebergPing()}
                style={{
                  background: '#1A1D24',
                  color: '#38BDF8',
                  border: '1px solid #2D3648',
                  borderRadius: '4px',
                  padding: '6px 12px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                ▶ Iceberg Ping
              </button>
              <button
                type="button"
                onClick={() => SoundManager.playStackSwoosh()}
                style={{
                  background: '#1A1D24',
                  color: '#10B981',
                  border: '1px solid #2D3648',
                  borderRadius: '4px',
                  padding: '6px 12px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                ▶ Stack Swoosh
              </button>
              <button
                type="button"
                onClick={() => SoundManager.playDivergenceWarning()}
                style={{
                  background: '#1A1D24',
                  color: '#F87171',
                  border: '1px solid #2D3648',
                  borderRadius: '4px',
                  padding: '6px 12px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                ▶ Divergence Alert
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid #2B303C',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '10px',
            background: '#161920',
          }}
        >
          <button
            onClick={onClose}
            style={{
              background: '#2B303C',
              color: '#8E9AA8',
              border: 'none',
              padding: '6px 16px',
              borderRadius: '4px',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={{
              background: '#00E676',
              color: '#0B0D12',
              border: 'none',
              padding: '6px 16px',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Save Preferences
          </button>
        </div>
      </div>
    </div>
  );
};
