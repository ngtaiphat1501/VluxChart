import React, { useState, useEffect } from 'react';
import {
  optionsLiveService,
  LiveOptionsChainResult,
  OptionsExpiryFilter,
  EnrichedStrikeMetrics,
} from '../services/optionsLiveService';

interface OptionsBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
  instrumentId: string;
  currentPriceTicks?: number | null;
}

export const OptionsBoardModal: React.FC<OptionsBoardModalProps> = ({
  isOpen,
  onClose,
  instrumentId,
  currentPriceTicks,
}) => {
  const [selectedExpiry, setSelectedExpiry] = useState<OptionsExpiryFilter>('ALL');
  const [activeTab, setActiveTab] = useState<'chain' | 'xray' | 'strategy'>('chain');
  const [liveChain, setLiveChain] = useState<LiveOptionsChainResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Strategy Analyzer State
  const [strategyType, setStrategyType] = useState<'straddle' | 'bull_call' | 'bear_put' | 'iron_condor'>('straddle');
  const [contractsCount, setContractsCount] = useState<number>(1);

  useEffect(() => {
    if (!isOpen) return;
    let isCancelled = false;
    setIsLoading(true);

    const loadChain = async () => {
      const res = await optionsLiveService.getLiveOptionsChain(
        instrumentId,
        selectedExpiry,
        currentPriceTicks
      );
      if (!isCancelled) {
        setLiveChain(res);
        setIsLoading(false);
      }
    };

    loadChain();
    const timer = setInterval(loadChain, 20_000);
    return () => {
      isCancelled = true;
      clearInterval(timer);
    };
  }, [isOpen, instrumentId, selectedExpiry, currentPriceTicks]);

  if (!isOpen) return null;

  const spot = liveChain?.underlyingPrice || (currentPriceTicks ? currentPriceTicks / 100 : 0);
  const avgIv =
    liveChain && liveChain.strikes.length > 0
      ? liveChain.strikes.reduce((acc, s) => acc + s.avg_iv, 0) / liveChain.strikes.length
      : 55;
  const expectedMoveUsd = spot * 0.85 * (avgIv / 100) * Math.sqrt(7 / 365);

  const strikes = liveChain?.strikes || [];
  const sortedStrikes = [...strikes].sort((a, b) => b.strike_ticks - a.strike_ticks);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(5, 7, 12, 0.88)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: '16px',
        userSelect: 'none',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '1080px',
          maxWidth: '96vw',
          height: '780px',
          maxHeight: '92vh',
          background: '#0F121A',
          border: '1px solid #232938',
          borderRadius: '6px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.75)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar (ATAS Desktop Window Standard) */}
        <div
          style={{
            height: '42px',
            background: '#161922',
            borderBottom: '1px solid #232938',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 800, color: '#F1F5F9', letterSpacing: '0.4px' }}>
              OPTIONS BOARD & STRATEGY ANALYZER
            </span>
            <span
              style={{
                background: '#1E2330',
                color: '#38BDF8',
                border: '1px solid #2D3548',
                fontSize: '9px',
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: '3px',
                fontFamily: 'monospace',
              }}
            >
              DERIBIT L3 LIVE
            </span>
          </div>

          {/* Expiration Filter Tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            {(['ALL', '0DTE', 'WEEKLY', 'MONTHLY'] as const).map((exp) => (
              <button
                key={exp}
                onClick={() => setSelectedExpiry(exp)}
                style={{
                  background: selectedExpiry === exp ? '#262D3D' : '#141720',
                  color: selectedExpiry === exp ? '#FFFFFF' : '#64748B',
                  border: `1px solid ${selectedExpiry === exp ? '#3B455B' : '#1E2330'}`,
                  borderRadius: '3px',
                  padding: '2px 8px',
                  fontSize: '9.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {exp}
              </button>
            ))}

            <button
              onClick={onClose}
              style={{
                marginLeft: '8px',
                background: 'transparent',
                border: 'none',
                color: '#64748B',
                cursor: 'pointer',
                fontSize: '13px',
                padding: '2px 6px',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Institutional Metrics Ribbon (Expected Move, Walls, Max Pain, PCR) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            background: '#12151D',
            borderBottom: '1px solid #1E2330',
            padding: '6px 14px',
            gap: '8px',
            fontSize: '10px',
            fontFamily: 'monospace',
          }}
        >
          <div>
            <div style={{ color: '#64748B', fontSize: '9px' }}>SPOT PRICE</div>
            <div style={{ color: '#F8FAFC', fontWeight: 800 }}>${Math.round(spot).toLocaleString()}</div>
          </div>
          <div>
            <div style={{ color: '#64748B', fontSize: '9px' }}>EXPECTED MOVE (7D)</div>
            <div style={{ color: '#38BDF8', fontWeight: 800 }}>±${Math.round(expectedMoveUsd).toLocaleString()}</div>
          </div>
          <div>
            <div style={{ color: '#64748B', fontSize: '9px' }}>CALL WALL (RESISTANCE)</div>
            <div style={{ color: '#10B981', fontWeight: 800 }}>
              ${Math.round((liveChain?.callWallStrikeTicks || 0) / 100).toLocaleString()}
            </div>
          </div>
          <div>
            <div style={{ color: '#64748B', fontSize: '9px' }}>PUT WALL (SUPPORT)</div>
            <div style={{ color: '#EF4444', fontWeight: 800 }}>
              ${Math.round((liveChain?.putWallStrikeTicks || 0) / 100).toLocaleString()}
            </div>
          </div>
          <div>
            <div style={{ color: '#64748B', fontSize: '9px' }}>MAX PAIN STRIKE</div>
            <div style={{ color: '#FBBF24', fontWeight: 800 }}>
              ${Math.round((liveChain?.maxPainStrikeTicks || 0) / 100).toLocaleString()}
            </div>
          </div>
          <div>
            <div style={{ color: '#64748B', fontSize: '9px' }}>P/C RATIO (OI)</div>
            <div style={{ color: '#CBD5E1', fontWeight: 800 }}>{liveChain?.putCallRatio.toFixed(2) || '1.00'}</div>
          </div>
        </div>

        {/* View Mode Tabs (Options Chain vs X-Ray GEX vs Strategy Payoff) */}
        <div
          style={{
            display: 'flex',
            background: '#161922',
            borderBottom: '1px solid #232938',
            padding: '0 14px',
            gap: '4px',
          }}
        >
          {[
            { id: 'chain' as const, label: 'Options Chain (Calls × Strike × Puts)' },
            { id: 'xray' as const, label: 'Options X-Ray & GEX Profile' },
            { id: 'strategy' as const, label: 'Strategy Analyzer & Payoff Diagram' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                background: activeTab === tab.id ? '#202532' : 'transparent',
                color: activeTab === tab.id ? '#FFFFFF' : '#64748B',
                border: 'none',
                borderBottom: activeTab === tab.id ? '2px solid #38BDF8' : '2px solid transparent',
                padding: '6px 12px',
                fontSize: '10.5px',
                fontWeight: activeTab === tab.id ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Main Content Area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
          {isLoading && !liveChain ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748B', fontSize: '12px' }}>
              ĐANG NẠP DỮ LIỆU SỔ LỆNH QUYỀN CHỌN DERIBIT THỜI GIAN THỰC...
            </div>
          ) : activeTab === 'chain' ? (
            /* TAB 1: CLASSIC WALL STREET OPTIONS CHAIN MATRIX */
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '10px',
                fontFamily: 'monospace',
                textAlign: 'right',
              }}
            >
              <thead>
                <tr style={{ background: '#181C26', color: '#94A3B8', borderBottom: '1px solid #262D3D' }}>
                  <th style={{ padding: '6px 4px', textAlign: 'left', color: '#10B981' }}>CALLS OI</th>
                  <th style={{ padding: '6px 4px' }}>CALL VOL</th>
                  <th style={{ padding: '6px 4px' }}>IV %</th>
                  <th style={{ padding: '6px 4px', textAlign: 'center', background: '#202532', color: '#F1F5F9' }}>
                    STRIKE ($)
                  </th>
                  <th style={{ padding: '6px 4px', textAlign: 'center' }}>IV %</th>
                  <th style={{ padding: '6px 4px' }}>PUT VOL</th>
                  <th style={{ padding: '6px 4px', color: '#EF4444' }}>PUTS OI</th>
                  <th style={{ padding: '6px 4px', color: '#38BDF8' }}>NET GEX ($)</th>
                </tr>
              </thead>
              <tbody>
                {sortedStrikes.map((s) => {
                  const strikePrice = Math.round(s.strike_ticks / 100);
                  const isAtm = Math.abs(strikePrice - spot) < spot * 0.015;
                  const isCallWall = s.strike_ticks === liveChain?.callWallStrikeTicks;
                  const isPutWall = s.strike_ticks === liveChain?.putWallStrikeTicks;
                  const isMaxPain = s.strike_ticks === liveChain?.maxPainStrikeTicks;

                  return (
                    <tr
                      key={s.strike_ticks}
                      style={{
                        borderBottom: '1px solid #161A24',
                        background: isAtm
                          ? 'rgba(56, 189, 248, 0.08)'
                          : isCallWall
                          ? 'rgba(16, 185, 129, 0.08)'
                          : isPutWall
                          ? 'rgba(239, 68, 68, 0.08)'
                          : 'transparent',
                      }}
                    >
                      <td style={{ padding: '4px 4px', textAlign: 'left', color: '#10B981', fontWeight: 700 }}>
                        {s.call_oi.toLocaleString()}
                      </td>
                      <td style={{ padding: '4px 4px', color: '#94A3B8' }}>{s.call_vol.toLocaleString()}</td>
                      <td style={{ padding: '4px 4px', color: '#CBD5E1' }}>{s.avg_iv.toFixed(1)}%</td>

                      {/* Center Strike with Badges */}
                      <td
                        style={{
                          padding: '4px 8px',
                          textAlign: 'center',
                          fontWeight: 800,
                          background: '#161922',
                          color: isAtm ? '#38BDF8' : '#F8FAFC',
                          borderLeft: '1px solid #232938',
                          borderRight: '1px solid #232938',
                        }}
                      >
                        ${strikePrice.toLocaleString()}
                        {isCallWall && <span style={{ color: '#10B981', marginLeft: '4px', fontSize: '8px' }}>[CW]</span>}
                        {isPutWall && <span style={{ color: '#EF4444', marginLeft: '4px', fontSize: '8px' }}>[PW]</span>}
                        {isMaxPain && <span style={{ color: '#FBBF24', marginLeft: '4px', fontSize: '8px' }}>[MP]</span>}
                      </td>

                      <td style={{ padding: '4px 4px', textAlign: 'center', color: '#CBD5E1' }}>{s.avg_iv.toFixed(1)}%</td>
                      <td style={{ padding: '4px 4px', color: '#94A3B8' }}>{s.put_vol.toLocaleString()}</td>
                      <td style={{ padding: '4px 4px', color: '#EF4444', fontWeight: 700 }}>
                        {s.put_oi.toLocaleString()}
                      </td>
                      <td
                        style={{
                          padding: '4px 4px',
                          color: s.net_gex_usd >= 0 ? '#10B981' : '#EF4444',
                          fontWeight: 600,
                        }}
                      >
                        {s.net_gex_usd >= 0 ? '+' : ''}${(s.net_gex_usd / 1e6).toFixed(1)}M
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : activeTab === 'xray' ? (
            /* TAB 2: OPTIONS X-RAY & GEX HEATMAP */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontSize: '11px', color: '#94A3B8', lineHeight: 1.5 }}>
                <strong>Options X-Ray & Dealer Gamma Regime:</strong> Khi Net GEX dương, Market Maker hedging làm giảm độ dao động (Volatility Dampener). Khi Net GEX âm, hedging ép thị trường biến động cực đại (Volatility Accelerator).
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {sortedStrikes.slice(0, 18).map((s) => {
                  const gexM = s.net_gex_usd / 1e6;
                  const isPos = gexM >= 0;
                  const barW = Math.min(100, Math.abs(gexM) * 3);
                  return (
                    <div
                      key={s.strike_ticks}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '80px 1fr 1fr 90px',
                        alignItems: 'center',
                        fontSize: '10px',
                        fontFamily: 'monospace',
                        gap: '8px',
                      }}
                    >
                      <span style={{ color: '#CBD5E1', fontWeight: 700 }}>
                        ${Math.round(s.strike_ticks / 100).toLocaleString()}
                      </span>
                      {/* Left: Negative GEX bar */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        {!isPos && (
                          <div
                            style={{
                              width: `${barW}%`,
                              height: '10px',
                              background: '#EF4444',
                              borderRadius: '2px',
                            }}
                          />
                        )}
                      </div>
                      {/* Right: Positive GEX bar */}
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        {isPos && (
                          <div
                            style={{
                              width: `${barW}%`,
                              height: '10px',
                              background: '#10B981',
                              borderRadius: '2px',
                            }}
                          />
                        )}
                      </div>
                      <span style={{ textAlign: 'right', color: isPos ? '#10B981' : '#EF4444' }}>
                        {isPos ? '+' : ''}
                        {gexM.toFixed(2)}M
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* TAB 3: STRATEGY ANALYZER & PAYOFF */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '11px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ color: '#94A3B8', fontWeight: 600 }}>Chiến lược cấu trúc:</span>
                {[
                  { id: 'straddle', label: 'Long Straddle (Biến động hai chiều)' },
                  { id: 'bull_call', label: 'Bull Call Spread (Tăng giá có giới hạn)' },
                  { id: 'bear_put', label: 'Bear Put Spread (Giảm giá có giới hạn)' },
                  { id: 'iron_condor', label: 'Iron Condor (Biên độ hẹp ăn Premium)' },
                ].map((st) => (
                  <button
                    key={st.id}
                    onClick={() => setStrategyType(st.id as any)}
                    style={{
                      background: strategyType === st.id ? '#262D3D' : '#141720',
                      color: strategyType === st.id ? '#FFFFFF' : '#94A3B8',
                      border: `1px solid ${strategyType === st.id ? '#38BDF8' : '#232938'}`,
                      borderRadius: '3px',
                      padding: '4px 8px',
                      fontSize: '10px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {st.label}
                  </button>
                ))}
              </div>

              {/* Payoff Simulation Box */}
              <div
                style={{
                  background: '#141720',
                  border: '1px solid #232938',
                  borderRadius: '4px',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  fontFamily: 'monospace',
                }}
              >
                <div style={{ color: '#38BDF8', fontWeight: 700 }}>
                  MÔ PHỎNG ĐIỂM HÒA VỐN & LỢI NHUẬN TỐI ĐA (EXPIRATION PAYOFF)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', fontSize: '10.5px' }}>
                  <div>
                    <span style={{ color: '#64748B' }}>Điểm Hòa Vốn Dưới:</span>
                    <strong style={{ color: '#F1F5F9', marginLeft: '6px' }}>
                      ${Math.round(spot - expectedMoveUsd).toLocaleString()}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748B' }}>Điểm Hòa Vốn Trên:</span>
                    <strong style={{ color: '#F1F5F9', marginLeft: '6px' }}>
                      ${Math.round(spot + expectedMoveUsd).toLocaleString()}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748B' }}>Lợi Nhuận Tối Đa:</span>
                    <strong style={{ color: '#10B981', marginLeft: '6px' }}>
                      {strategyType === 'straddle' ? 'Không giới hạn (Unlimited)' : `+$${(expectedMoveUsd * 0.8).toFixed(0)}`}
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
