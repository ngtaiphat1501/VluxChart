import React, { useState } from 'react';
import { TradeEventDTO } from '../types';
import { formatInstrumentPrice, getInstrumentMeta } from '../utils/instrumentRegistry';

interface TimeAndSalesTapeProps {
  trades: TradeEventDTO[];
  instrumentId?: string;
  onClose?: () => void;
  onPopOutToggle?: () => void;
  isFloating?: boolean;
}

export const TimeAndSalesTape: React.FC<TimeAndSalesTapeProps> = ({
  trades = [],
  instrumentId,
  onClose,
  onPopOutToggle,
  isFloating = false,
}) => {
  const [minQty, setMinQty] = useState<number>(0);

  const instMeta = getInstrumentMeta(instrumentId || 'BYBIT:LINEAR_PERP:BTCUSDT:PERP');
  const isBtc = !instrumentId || instrumentId.includes('BTC');
  const qtyScale = instMeta.venue === 'MT5' ? 10 : isBtc ? 1000 : 100;
  const precision = instMeta.venue === 'MT5' ? 2 : isBtc ? 3 : 2;

  const filteredTrades = trades.filter((t) => t.quantity_units >= minQty * qtyScale);

  const formatTime = (us: number) => {
    const d = new Date(us / 1000);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  };

  return (
    <div
      style={{
        width: isFloating ? '100%' : '240px',
        background: '#161920',
        borderLeft: isFloating ? 'none' : '1px solid #2B303C',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        userSelect: 'none',
        fontFamily: 'monospace',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '8px 12px',
          background: '#1A1D24',
          borderBottom: '1px solid #2B303C',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '11px', fontWeight: 800, color: '#E2E8F0', letterSpacing: '0.3px' }}>TIME &amp; SALES</span>
          <span style={{ fontSize: '9px', background: 'rgba(16, 185, 129, 0.14)', border: '1px solid rgba(16, 185, 129, 0.4)', color: '#34D399', padding: '1px 5px', borderRadius: '3px', fontWeight: 700 }}>
            LIVE
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {onPopOutToggle && (
            <button
              onClick={onPopOutToggle}
              style={{
                background: '#2B303C',
                color: '#FFF',
                border: 'none',
                borderRadius: '3px',
                padding: '2px 6px',
                fontSize: '10px',
                cursor: 'pointer',
                fontWeight: 600,
              }}
              title={isFloating ? 'Dock panel to sidebar' : 'Pop out into floating window'}
            >
              {isFloating ? '↙' : '↗'}
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#8E9AA8',
                cursor: 'pointer',
                fontSize: '14px',
                padding: '0 4px',
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Filter Toolbar */}
      <div
        style={{
          padding: '4px 8px',
          background: '#14171E',
          borderBottom: '1px solid #20242D',
          display: 'flex',
          gap: '4px',
        }}
      >
        {[
          { label: 'ALL', val: 0 },
          { label: '≥10', val: 10 },
          { label: '≥100', val: 100 },
          { label: '≥500', val: 500 },
        ].map((btn) => (
          <button
            key={btn.label}
            onClick={() => setMinQty(btn.val)}
            style={{
              flex: 1,
              background: minQty === btn.val ? '#00E676' : '#252932',
              color: minQty === btn.val ? '#0B0D12' : '#8E9AA8',
              border: 'none',
              borderRadius: '3px',
              fontSize: '10px',
              fontWeight: 700,
              padding: '2px 0',
              cursor: 'pointer',
            }}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* Column Headers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '70px 1fr 1fr 30px',
          padding: '4px 8px',
          background: '#121418',
          fontSize: '9px',
          fontWeight: 700,
          color: '#8E9AA8',
          borderBottom: '1px solid #20242D',
        }}
      >
        <span>TIME</span>
        <span style={{ textAlign: 'right' }}>PRICE</span>
        <span style={{ textAlign: 'right' }}>QTY</span>
        <span style={{ textAlign: 'center' }}>SIDE</span>
      </div>

      {/* Trades List */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {filteredTrades.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#8E9AA8', fontSize: '11px' }}>
            Awaiting matching trades...
          </div>
        ) : (
          filteredTrades.map((t, idx) => {
            const isBuy = t.aggressor === 'Buy';
            const isSell = t.aggressor === 'Sell';
            const isWhale = t.quantity_units >= 500;
            const sideColor = isBuy ? '#00E676' : isSell ? '#FF5252' : '#B0BEC5';

            return (
              <div
                key={t.event_id || idx}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '70px 1fr 1fr 30px',
                  padding: '3px 8px',
                  fontSize: '10px',
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                  background: isWhale
                    ? 'rgba(255, 145, 0, 0.12)'
                    : idx === 0
                    ? 'rgba(255,255,255,0.05)'
                    : 'transparent',
                }}
              >
                <span style={{ color: '#8E9AA8', fontSize: '9px' }}>{formatTime(t.exchange_ts_us)}</span>
                <span style={{ textAlign: 'right', color: '#FFF', fontWeight: 600 }}>
                  {formatInstrumentPrice(t.price_ticks, instrumentId || 'BYBIT:LINEAR_PERP:BTCUSDT:PERP')}
                </span>
                <span
                  style={{
                    textAlign: 'right',
                    color: isWhale ? '#FF9100' : sideColor,
                    fontWeight: isWhale ? 700 : 500,
                  }}
                >
                  {(t.quantity_units / qtyScale).toFixed(precision)}
                </span>
                <span
                  style={{
                    textAlign: 'center',
                    color: sideColor,
                    fontWeight: 700,
                    fontSize: '9px',
                  }}
                >
                  {isBuy ? 'B' : isSell ? 'S' : '?'}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
