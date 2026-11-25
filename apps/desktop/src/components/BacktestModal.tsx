import React, { useState } from 'react';
import {
  BacktestConfigDTO,
  BacktestReportDTO,
  OptimizationReportDTO,
  OptimizationSweepConfigDTO,
} from '../types';

interface BacktestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRunBacktest: (config: BacktestConfigDTO) => Promise<BacktestReportDTO>;
  onRunOptimization?: (config: OptimizationSweepConfigDTO) => Promise<OptimizationReportDTO>;
}

export const BacktestModal: React.FC<BacktestModalProps> = ({
  isOpen,
  onClose,
  onRunBacktest,
  onRunOptimization,
}) => {
  const [activeTab, setActiveTab] = useState<'backtest' | 'optimizer'>('backtest');
  const [strategy, setStrategy] = useState<string>('StackedImbalancePullback');
  const [tradeSize, setTradeSize] = useState<number>(1);
  const [stopLossTicks, setStopLossTicks] = useState<number>(1500);
  const [takeProfitTicks, setTakeProfitTicks] = useState<number>(3000);
  const [slippageTicks, setSlippageTicks] = useState<number>(10);
  const [loading, setLoading] = useState<boolean>(false);
  const [report, setReport] = useState<BacktestReportDTO | null>(null);
  const [optReport, setOptReport] = useState<OptimizationReportDTO | null>(null);

  if (!isOpen) return null;

  const handleExecuteBacktest = async () => {
    setLoading(true);
    try {
      const res = await onRunBacktest({
        strategy_name: strategy,
        trade_size_units: tradeSize,
        stop_loss_ticks: stopLossTicks,
        take_profit_ticks: takeProfitTicks,
        slippage_ticks: slippageTicks,
      });
      setReport(res);
    } catch (e) {
      console.error('Backtest error:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteOptimization = async () => {
    if (!onRunOptimization) return;
    setLoading(true);
    try {
      const res = await onRunOptimization({
        strategy_name: strategy,
        stop_loss_range: [500, 1000, 1500, 2000, 2500, 3000],
        take_profit_range: [1000, 2000, 3000, 4000, 5000, 6000],
        trade_size_units: tradeSize,
        slippage_ticks: slippageTicks,
      });
      setOptReport(res);
    } catch (e) {
      console.error('Optimization error:', e);
    } finally {
      setLoading(false);
    }
  };

  const applyOptimal = (sl: number, tp: number) => {
    setStopLossTicks(sl);
    setTakeProfitTicks(tp);
    setActiveTab('backtest');
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
          width: '920px',
          maxHeight: '92vh',
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
        {/* Header & Tabs */}
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid #2B303C',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#161920',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 800,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: '#34D399',
                  background: 'rgba(16, 185, 129, 0.14)',
                  border: '1px solid rgba(16, 185, 129, 0.45)',
                  borderRadius: '4px',
                  padding: '3px 7px',
                }}
              >
                QUANT
              </span>
              <div>
                <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#FFF' }}>
                  Order Flow Quantitative Research Suite
                </h2>
                <p style={{ margin: '1px 0 0 0', fontSize: '11px', color: '#8E9AA8' }}>
                  Execution Fill Modeling &amp; Automated Grid-Search Optimizer
                </p>
              </div>
            </div>

            {/* Mode Switcher Tabs */}
            <div style={{ display: 'flex', background: '#252932', padding: '2px', borderRadius: '5px' }}>
              <button
                onClick={() => setActiveTab('backtest')}
                style={{
                  background: activeTab === 'backtest' ? '#00E676' : 'transparent',
                  color: activeTab === 'backtest' ? '#0B0D12' : '#8E9AA8',
                  border: 'none',
                  padding: '4px 12px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                SINGLE BACKTEST
              </button>
              <button
                onClick={() => setActiveTab('optimizer')}
                style={{
                  background: activeTab === 'optimizer' ? '#7C4DFF' : 'transparent',
                  color: activeTab === 'optimizer' ? '#FFFFFF' : '#8E9AA8',
                  border: 'none',
                  padding: '4px 12px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                GRID OPTIMIZER
              </button>
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

        {/* Tab 1: Single Backtest */}
        {activeTab === 'backtest' ? (
          <>
            {/* Configuration Bar */}
            <div
              style={{
                padding: '14px 20px',
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr) auto',
                gap: '12px',
                alignItems: 'end',
                background: '#20242D',
                borderBottom: '1px solid #2B303C',
              }}
            >
              <div>
                <label style={{ fontSize: '10px', color: '#8E9AA8', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  STRATEGY
                </label>
                <select
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#161920',
                    color: '#FFF',
                    border: '1px solid #3F4656',
                    borderRadius: '4px',
                    padding: '6px 8px',
                    fontSize: '11px',
                  }}
                >
                  <option value="StackedImbalancePullback">3x Stacked Imbalances</option>
                  <option value="AbsorptionReversal">Absorption Reversal</option>
                  <option value="DeltaDivergence">CVD Divergence</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '10px', color: '#8E9AA8', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  UNITS (CONTRACTS)
                </label>
                <input
                  type="number"
                  value={tradeSize}
                  min={1}
                  onChange={(e) => setTradeSize(Number(e.target.value))}
                  style={{
                    width: '100%',
                    background: '#161920',
                    color: '#FFF',
                    border: '1px solid #3F4656',
                    borderRadius: '4px',
                    padding: '6px 8px',
                    fontSize: '11px',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '10px', color: '#8E9AA8', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  STOP LOSS (TICKS)
                </label>
                <input
                  type="number"
                  value={stopLossTicks}
                  step={100}
                  onChange={(e) => setStopLossTicks(Number(e.target.value))}
                  style={{
                    width: '100%',
                    background: '#161920',
                    color: '#FFF',
                    border: '1px solid #3F4656',
                    borderRadius: '4px',
                    padding: '6px 8px',
                    fontSize: '11px',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '10px', color: '#8E9AA8', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  TAKE PROFIT (TICKS)
                </label>
                <input
                  type="number"
                  value={takeProfitTicks}
                  step={100}
                  onChange={(e) => setTakeProfitTicks(Number(e.target.value))}
                  style={{
                    width: '100%',
                    background: '#161920',
                    color: '#FFF',
                    border: '1px solid #3F4656',
                    borderRadius: '4px',
                    padding: '6px 8px',
                    fontSize: '11px',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '10px', color: '#8E9AA8', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  SLIPPAGE (TICKS)
                </label>
                <input
                  type="number"
                  value={slippageTicks}
                  step={1}
                  onChange={(e) => setSlippageTicks(Number(e.target.value))}
                  style={{
                    width: '100%',
                    background: '#161920',
                    color: '#FFF',
                    border: '1px solid #3F4656',
                    borderRadius: '4px',
                    padding: '6px 8px',
                    fontSize: '11px',
                  }}
                />
              </div>

              <button
                onClick={handleExecuteBacktest}
                disabled={loading}
                style={{
                  background: loading ? '#3F4656' : '#00E676',
                  color: loading ? '#8E9AA8' : '#0B0D12',
                  border: 'none',
                  padding: '7px 16px',
                  borderRadius: '5px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  height: '31px',
                }}
              >
                {loading ? 'RUNNING...' : '▶ RUN BACKTEST'}
              </button>
            </div>

            {/* Content Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {report ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Performance KPI Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' }}>
                    <div style={{ background: '#161920', border: '1px solid #2B303C', borderRadius: '6px', padding: '10px' }}>
                      <div style={{ fontSize: '10px', color: '#8E9AA8', fontWeight: 600 }}>WIN RATE</div>
                      <div style={{ fontSize: '18px', fontWeight: 700, color: report.win_rate_pct >= 50 ? '#00E676' : '#FF5252', marginTop: '3px' }}>
                        {report.win_rate_pct.toFixed(1)}%
                      </div>
                      <div style={{ fontSize: '9px', color: '#8E9AA8', marginTop: '2px' }}>
                        {report.winning_trades}W / {report.losing_trades}L ({report.total_trades} trades)
                      </div>
                    </div>

                    <div style={{ background: '#161920', border: '1px solid #2B303C', borderRadius: '6px', padding: '10px' }}>
                      <div style={{ fontSize: '10px', color: '#8E9AA8', fontWeight: 600 }}>NET PROFIT</div>
                      <div style={{ fontSize: '18px', fontWeight: 700, color: report.net_pnl_ticks >= 0 ? '#00E676' : '#FF5252', marginTop: '3px' }}>
                        {(report.net_pnl_ticks / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                      </div>
                      <div style={{ fontSize: '9px', color: '#8E9AA8', marginTop: '2px' }}>
                        {report.net_pnl_ticks > 0 ? '+' : ''}{report.net_pnl_ticks.toLocaleString()} ticks
                      </div>
                    </div>

                    <div style={{ background: '#161920', border: '1px solid #2B303C', borderRadius: '6px', padding: '10px' }}>
                      <div style={{ fontSize: '10px', color: '#8E9AA8', fontWeight: 600 }}>PROFIT FACTOR</div>
                      <div style={{ fontSize: '18px', fontWeight: 700, color: report.profit_factor >= 1.5 ? '#00E676' : '#E1E4EA', marginTop: '3px' }}>
                        {report.profit_factor.toFixed(2)}
                      </div>
                      <div style={{ fontSize: '9px', color: '#8E9AA8', marginTop: '2px' }}>
                        +{(report.gross_profit_ticks / 100).toFixed(0)} / -{(report.gross_loss_ticks / 100).toFixed(0)}
                      </div>
                    </div>

                    <div style={{ background: '#161920', border: '1px solid #2B303C', borderRadius: '6px', padding: '10px' }}>
                      <div style={{ fontSize: '10px', color: '#8E9AA8', fontWeight: 600 }}>MAX DRAWDOWN</div>
                      <div style={{ fontSize: '18px', fontWeight: 700, color: '#FF5252', marginTop: '3px' }}>
                        -{report.max_drawdown_pct.toFixed(2)}%
                      </div>
                      <div style={{ fontSize: '9px', color: '#8E9AA8', marginTop: '2px' }}>
                        -{(report.max_drawdown_ticks / 100).toLocaleString()} USD
                      </div>
                    </div>

                    <div style={{ background: '#161920', border: '1px solid #2B303C', borderRadius: '6px', padding: '10px' }}>
                      <div style={{ fontSize: '10px', color: '#8E9AA8', fontWeight: 600 }}>AVG TRADE</div>
                      <div style={{ fontSize: '18px', fontWeight: 700, color: report.avg_trade_pnl_ticks >= 0 ? '#00E676' : '#FF5252', marginTop: '3px' }}>
                        {(report.avg_trade_pnl_ticks / 100).toFixed(2)} USD
                      </div>
                      <div style={{ fontSize: '9px', color: '#8E9AA8', marginTop: '2px' }}>
                        Per closed position
                      </div>
                    </div>
                  </div>

                  {/* Trade Log Table */}
                  <div>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: '#FFF' }}>
                      Execution Trade Log ({report.trades.length} fills)
                    </h4>
                    <div style={{ border: '1px solid #2B303C', borderRadius: '6px', overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'left' }}>
                        <thead>
                          <tr style={{ background: '#161920', color: '#8E9AA8', borderBottom: '1px solid #2B303C' }}>
                            <th style={{ padding: '6px 10px' }}>#</th>
                            <th style={{ padding: '6px 10px' }}>SIDE</th>
                            <th style={{ padding: '6px 10px' }}>ENTRY</th>
                            <th style={{ padding: '6px 10px' }}>EXIT</th>
                            <th style={{ padding: '6px 10px' }}>PNL (USD)</th>
                            <th style={{ padding: '6px 10px' }}>RETURN %</th>
                            <th style={{ padding: '6px 10px' }}>EXIT REASON</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.trades.map((t) => (
                            <tr
                              key={t.trade_id}
                              style={{
                                borderBottom: '1px solid #20242D',
                                background: t.pnl_ticks >= 0 ? 'rgba(0, 230, 118, 0.03)' : 'rgba(255, 82, 82, 0.03)',
                              }}
                            >
                              <td style={{ padding: '6px 10px', color: '#8E9AA8' }}>{t.trade_id}</td>
                              <td style={{ padding: '6px 10px', fontWeight: 700, color: t.side === 'Buy' ? '#00E676' : '#FF5252' }}>
                                {t.side.toUpperCase()}
                              </td>
                              <td style={{ padding: '6px 10px' }}>{(t.entry_price_ticks / 100).toFixed(2)}</td>
                              <td style={{ padding: '6px 10px' }}>{(t.exit_price_ticks / 100).toFixed(2)}</td>
                              <td style={{ padding: '6px 10px', fontWeight: 700, color: t.pnl_ticks >= 0 ? '#00E676' : '#FF5252' }}>
                                {t.pnl_ticks > 0 ? '+' : ''}{(t.pnl_ticks / 100).toFixed(2)}
                              </td>
                              <td style={{ padding: '6px 10px', color: t.pnl_pct >= 0 ? '#00E676' : '#FF5252' }}>
                                {t.pnl_pct > 0 ? '+' : ''}{t.pnl_pct.toFixed(2)}%
                              </td>
                              <td style={{ padding: '6px 10px', color: '#8E9AA8' }}>
                                <span
                                  style={{
                                    background: t.exit_reason === 'TakeProfit' ? '#1B5E20' : t.exit_reason === 'StopLoss' ? '#B71C1C' : '#37474F',
                                    color: '#FFF',
                                    padding: '1px 5px',
                                    borderRadius: '3px',
                                    fontSize: '9px',
                                    fontWeight: 700,
                                  }}
                                >
                                  {t.exit_reason.toUpperCase()}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '220px', color: '#8E9AA8', gap: '8px' }}>
                  <div style={{ fontSize: '12px' }}>Configure parameters above and click <strong>RUN BACKTEST</strong> to execute fill simulation on real bars.</div>
                </div>
              )}
            </div>
          </>
        ) : (
          /* Tab 2: Grid Search Optimizer */
          <div style={{ flex: 1, padding: '16px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Optimizer Header Bar */}
            <div
              style={{
                background: '#20242D',
                padding: '12px 16px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#FFF' }}>
                  Automated 36-Combination Parameter Grid Search (SL: 500-3000 ticks × TP: 1000-6000 ticks)
                </div>
                <div style={{ fontSize: '11px', color: '#8E9AA8' }}>
                  Scans parameter stability islands to avoid overfitting on market noise.
                </div>
              </div>
              <button
                onClick={handleExecuteOptimization}
                disabled={loading}
                style={{
                  background: loading ? '#3F4656' : '#7C4DFF',
                  color: '#FFF',
                  border: 'none',
                  padding: '8px 18px',
                  borderRadius: '5px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'SWEEPING MATRIX...' : 'RUN GRID OPTIMIZER'}
              </button>
            </div>

            {optReport ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Optimal Parameters Banner */}
                <div
                  style={{
                    background: 'rgba(124, 77, 255, 0.12)',
                    border: '1px solid #7C4DFF',
                    borderRadius: '6px',
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', gap: '20px' }}>
                    <div>
                      <div style={{ fontSize: '10px', color: '#D1C4E9' }}>OPTIMAL STOP LOSS</div>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#FFF' }}>
                        {optReport.best_stop_loss_ticks} ticks (${(optReport.best_stop_loss_ticks / 100).toFixed(2)})
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '10px', color: '#D1C4E9' }}>OPTIMAL TAKE PROFIT</div>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#FFF' }}>
                        {optReport.best_take_profit_ticks} ticks (${(optReport.best_take_profit_ticks / 100).toFixed(2)})
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '10px', color: '#D1C4E9' }}>BEST PROFIT FACTOR</div>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#00E676' }}>
                        {optReport.best_profit_factor.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '10px', color: '#D1C4E9' }}>MAX NET PNL</div>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#00E676' }}>
                        +${(optReport.best_net_pnl_ticks / 100).toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => applyOptimal(optReport.best_stop_loss_ticks, optReport.best_take_profit_ticks)}
                    style={{
                      background: '#00E676',
                      color: '#0B0D12',
                      border: 'none',
                      padding: '8px 14px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    APPLY OPTIMAL PARAMETERS
                  </button>
                </div>

                {/* Optimization Matrix Heatmap Table */}
                <div>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: '#FFF' }}>
                    Parameter Surface Matrix (Stop Loss vs Take Profit)
                  </h4>
                  <div style={{ border: '1px solid #2B303C', borderRadius: '6px', overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'center' }}>
                      <thead>
                        <tr style={{ background: '#161920', color: '#8E9AA8', borderBottom: '1px solid #2B303C' }}>
                          <th style={{ padding: '8px', textAlign: 'left' }}>SL \ TP</th>
                          {[1000, 2000, 3000, 4000, 5000, 6000].map((tp) => (
                            <th key={tp} style={{ padding: '8px' }}>TP: {tp}t</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[500, 1000, 1500, 2000, 2500, 3000].map((sl) => (
                          <tr key={sl} style={{ borderBottom: '1px solid #20242D' }}>
                            <td style={{ padding: '8px', fontWeight: 700, color: '#8E9AA8', textAlign: 'left', background: '#161920' }}>
                              SL: {sl}t
                            </td>
                            {[1000, 2000, 3000, 4000, 5000, 6000].map((tp) => {
                              const match = optReport.matrix.find(
                                (m) => m.stop_loss_ticks === sl && m.take_profit_ticks === tp
                              );
                              if (!match) return <td key={tp}>-</td>;

                              const isBest =
                                sl === optReport.best_stop_loss_ticks && tp === optReport.best_take_profit_ticks;
                              const isProfitable = match.net_pnl_ticks > 0;

                              return (
                                <td
                                  key={tp}
                                  onClick={() => applyOptimal(sl, tp)}
                                  title={`Click to Apply: SL=${sl}, TP=${tp} (Net: +$${(match.net_pnl_ticks / 100).toFixed(2)}, PF: ${match.profit_factor.toFixed(2)})`}
                                  style={{
                                    padding: '8px',
                                    cursor: 'pointer',
                                    background: isBest
                                      ? 'rgba(0, 230, 118, 0.25)'
                                      : isProfitable
                                      ? 'rgba(0, 230, 118, 0.08)'
                                      : 'rgba(255, 82, 82, 0.08)',
                                    border: isBest ? '1.5px solid #00E676' : 'none',
                                    color: isProfitable ? '#00E676' : '#FF5252',
                                    fontWeight: isBest ? 700 : 500,
                                  }}
                                >
                                  <div>PF: {match.profit_factor.toFixed(2)}</div>
                                  <div style={{ fontSize: '9px', color: '#8E9AA8' }}>
                                    {match.win_rate_pct.toFixed(0)}% W
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '240px', color: '#8E9AA8', gap: '8px' }}>
                <div style={{ fontSize: '12px' }}>Click <strong>RUN GRID OPTIMIZER</strong> to compute the 36-parameter sweep surface.</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
