import React, { useState, useEffect } from 'react';
import { DomLadderPanel } from './DomLadderPanel';
import { TimeAndSalesTape } from './TimeAndSalesTape';
import { ChartSnapshotDTO } from '../types';
import {
  getInstrumentMeta,
  formatInstrumentPrice,
  computePositionPnlUsd,
} from '../utils/instrumentRegistry';
import { mt5BridgeService, Mt5AccountConfig, Mt5OrderTicket } from '../services/mt5BridgeService';

export type RightDockTab = 'trading' | 'dom_tape' | 'dom' | 'tape' | 'insights' | 'greeks';

interface RightDockPanelProps {
  snapshot: ChartSnapshotDTO;
  activeTab: RightDockTab;
  onSelectTab: (tab: RightDockTab) => void;
  onClose: () => void;
  onPopOutDom?: () => void;
  onPopOutTape?: () => void;
  onOpenMt5Modal?: () => void;
  pickedOrderPriceTicks?: number | null;
  isPickingPriceOnChart?: boolean;
  onRequestPickPriceOnChart?: (active: boolean) => void;
}

export const RightDockPanel: React.FC<RightDockPanelProps> = ({
  snapshot,
  activeTab,
  onSelectTab,
  onClose,
  onPopOutDom,
  onPopOutTape,
  onOpenMt5Modal,
  pickedOrderPriceTicks,
  isPickingPriceOnChart = false,
  onRequestPickPriceOnChart,
}) => {
  const narrative = snapshot.market_narrative;
  const options = snapshot.options_summary;
  const instMeta = getInstrumentMeta(snapshot.instrument_id);
  const currentPriceTicks = snapshot.active_bar
    ? snapshot.active_bar.close_ticks
    : snapshot.bars[snapshot.bars.length - 1]?.close_ticks || instMeta.basePriceTicks;

  const pipStep = instMeta.pipTicks || instMeta.tickSize * 2;
  const bestBidTicks = snapshot.order_book?.bids?.[0]?.price_ticks || (currentPriceTicks - instMeta.tickSize);
  const bestAskTicks = snapshot.order_book?.asks?.[0]?.price_ticks || (currentPriceTicks + instMeta.tickSize);
  const spreadPips = Math.max(0.1, Number((Math.abs(bestAskTicks - bestBidTicks) / pipStep).toFixed(1)));

  // Live MT5 & Order Execution State
  const [mt5Account, setMt5Account] = useState<Mt5AccountConfig>(() => mt5BridgeService.getAccount());
  const [mt5Tickets, setMt5Tickets] = useState<Mt5OrderTicket[]>(() =>
    mt5BridgeService.getTickets(snapshot.instrument_id)
  );

  // Standard TradingView / MT5 Order Ticket State
  const [orderTab, setOrderTab] = useState<'MARKET' | 'LIMIT' | 'STOP'>('MARKET');
  const [orderLots, setOrderLots] = useState<number>(1.0);
  const [entryPriceTicks, setEntryPriceTicks] = useState<number>(() => currentPriceTicks);
  const [slEnabled, setSlEnabled] = useState<boolean>(true);
  const [tpEnabled, setTpEnabled] = useState<boolean>(true);
  const [slPips, setSlPips] = useState<number>(20);
  const [tpPips, setTpPips] = useState<number>(40);

  // Reset default entry price when switching symbol or switching to Limit/Stop tab
  useEffect(() => {
    setEntryPriceTicks(currentPriceTicks);
  }, [snapshot.instrument_id]);

  useEffect(() => {
    if (pickedOrderPriceTicks && pickedOrderPriceTicks > 0) {
      setEntryPriceTicks(pickedOrderPriceTicks);
      if (orderTab === 'MARKET') {
        setOrderTab('LIMIT');
      }
    }
  }, [pickedOrderPriceTicks]);

  useEffect(() => {
    setMt5Account({ ...mt5BridgeService.getAccount() });
    setMt5Tickets([...mt5BridgeService.getTickets(snapshot.instrument_id)]);
    const unsub = mt5BridgeService.subscribe(() => {
      setMt5Account({ ...mt5BridgeService.getAccount() });
      setMt5Tickets([...mt5BridgeService.getTickets(snapshot.instrument_id)]);
    });
    return unsub;
  }, [snapshot.instrument_id]);

  const openPositions = mt5Tickets.filter((t) => t.status === 'OPEN');
  const pendingOrders = mt5Tickets.filter((t) => t.status === 'PENDING');

  const netLots = openPositions.reduce(
    (sum, t) => sum + (t.side === 'Buy' ? t.lots : -t.lots),
    0
  );
  const openPnlUsd = openPositions.reduce(
    (sum, t) =>
      sum +
      (typeof t.profitUsd === 'number'
        ? t.profitUsd
        : computePositionPnlUsd(t.side, t.entryPriceTicks, currentPriceTicks, t.lots, snapshot.instrument_id)),
    0
  );
  const dailyPnlUsd =
    typeof mt5Account.floatingPnlUsd === 'number'
      ? mt5Account.floatingPnlUsd
      : mt5Account.equityUsd - mt5Account.balanceUsd || openPnlUsd;

  const getSlTpTicks = (side: 'BUY' | 'SELL', refEntryTicks: number) => {
    const slDist = slPips * pipStep;
    const tpDist = tpPips * pipStep;
    return {
      slTicks: slEnabled ? (side === 'BUY' ? refEntryTicks - slDist : refEntryTicks + slDist) : undefined,
      tpTicks: tpEnabled ? (side === 'BUY' ? refEntryTicks + tpDist : refEntryTicks - tpDist) : undefined,
    };
  };

  // Estimated Risk / Reward in USD for the ticket preview
  const refEntryForPreview = orderTab === 'MARKET' ? currentPriceTicks : entryPriceTicks || currentPriceTicks;
  const estSlUsd = slEnabled
    ? Math.abs(
        computePositionPnlUsd(
          'Buy',
          refEntryForPreview,
          refEntryForPreview - slPips * pipStep,
          orderLots,
          snapshot.instrument_id
        )
      )
    : 0;
  const estTpUsd = tpEnabled
    ? Math.abs(
        computePositionPnlUsd(
          'Buy',
          refEntryForPreview,
          refEntryForPreview + tpPips * pipStep,
          orderLots,
          snapshot.instrument_id
        )
      )
    : 0;
  const rrRatio = slEnabled && tpEnabled && slPips > 0 ? (tpPips / slPips).toFixed(2) : '--';

  const handleMarketOrder = (side: 'BUY' | 'SELL') => {
    if (!currentPriceTicks) return;
    const execTicks = side === 'BUY' ? bestAskTicks : bestBidTicks;
    const { slTicks, tpTicks } = getSlTpTicks(side, execTicks);
    mt5BridgeService.placeOrder({
      instrumentId: snapshot.instrument_id,
      side: side === 'BUY' ? 'Buy' : 'Sell',
      orderType: 'MARKET',
      lots: orderLots,
      entryPriceTicks: execTicks,
      slTicks,
      tpTicks,
      comment: 'TV-1Click-MKT',
    });
  };

  const handlePendingOrder = (side: 'BUY' | 'SELL', forcedType?: 'LIMIT' | 'STOP', customEntryTicks?: number) => {
    const targetEntry = customEntryTicks || entryPriceTicks || currentPriceTicks;
    if (!targetEntry) return;
    const finalType = forcedType || (orderTab === 'STOP' ? 'STOP' : 'LIMIT');
    const { slTicks, tpTicks } = getSlTpTicks(side, targetEntry);
    mt5BridgeService.placeOrder({
      instrumentId: snapshot.instrument_id,
      side: side === 'BUY' ? 'Buy' : 'Sell',
      orderType: finalType,
      lots: orderLots,
      entryPriceTicks: targetEntry,
      slTicks,
      tpTicks,
      comment: `TV-${side}-${finalType}`,
    });
  };

  const handleJoinBidAsk = (side: 'BUY' | 'SELL') => {
    const target = side === 'BUY' ? bestBidTicks : bestAskTicks;
    handlePendingOrder(side, 'LIMIT', target);
  };

  const handleCancelAll = () => {
    mt5BridgeService.cancelPending(snapshot.instrument_id);
  };

  const handleFlattenAll = () => {
    mt5BridgeService.flattenAll(snapshot.instrument_id, currentPriceTicks);
  };

  const symbolShort =
    instMeta.venue === 'MT5'
      ? `MT5:${instMeta.symbol}`
      : `${instMeta.symbol}-PERP`;

  return (
    <aside
      style={{
        width: activeTab === 'trading' ? '264px' : '310px',
        minWidth: activeTab === 'trading' ? '254px' : '280px',
        maxWidth: '380px',
        height: '100%',
        background: '#12151C',
        borderLeft: '1px solid #262932',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 15,
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      {/* Tab Navigation Header */}
      <div
        style={{
          height: '32px',
          background: '#16181D',
          borderBottom: '1px solid #262932',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 6px',
          gap: '2px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', overflowX: 'auto' }}>
          {[
            { id: 'trading' as const, label: 'TRADING', col: '#10B981' },
            { id: 'dom_tape' as const, label: 'DOM+TAPE', col: '#00E676' },
            { id: 'dom' as const, label: 'DOM', col: '#00E5FF' },
            { id: 'tape' as const, label: 'TAPE', col: '#FFD600' },
            { id: 'insights' as const, label: 'INTEL', col: '#A855F7' },
            { id: 'greeks' as const, label: 'GREEKS', col: '#C084FC' },
          ].map((tab) => {
            const isAct = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                style={{
                  background: isAct ? '#222631' : 'transparent',
                  color: isAct ? tab.col : '#8E9BAE',
                  border: 'none',
                  borderBottom: isAct ? `2px solid ${tab.col}` : '2px solid transparent',
                  padding: '4px 6px',
                  fontSize: '10px',
                  fontWeight: isAct ? 700 : 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#78889B',
            cursor: 'pointer',
            padding: '2px 5px',
            fontSize: '11px',
          }}
          title="Đóng bảng bên phải"
        >
          ✕
        </button>
      </div>

      {/* Content Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* ===================================================================
            TAB 1: TRADINGVIEW + MT5 + ATAS STANDARD ORDER TICKET & EXECUTION
            =================================================================== */}
        {activeTab === 'trading' && (
          <div
            style={{
              padding: '8px 9px',
              display: 'flex',
              flexDirection: 'column',
              gap: '7px',
              height: '100%',
              overflowY: 'auto',
              background: '#131722',
              fontFamily: "'Inter', sans-serif",
            }}
          >
            {/* 1. MT5 Connected Account Header Card */}
            <div
              onClick={onOpenMt5Modal}
              style={{
                background: 'rgba(0, 180, 216, 0.09)',
                border: '1px solid rgba(0, 229, 255, 0.32)',
                borderRadius: '5px',
                padding: '5px 8px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
              }}
              title="Nhấn để cấu hình Tài khoản MetaTrader 5 & Sàn Forex"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px' }}>
                <span style={{ color: '#00E5FF', fontWeight: 800 }}>
                  ● MT5 {mt5Account.broker} (#{mt5Account.login})
                </span>
                <span style={{ color: '#94A3B8', fontSize: '9.5px' }}>1:{mt5Account.leverage} ⚙</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#CBD5E1', fontFamily: 'monospace' }}>
                <span>{symbolShort}</span>
                <span>Eq: <strong style={{ color: '#F8FAFC' }}>${mt5Account.equityUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></span>
              </div>
              {mt5Account.marketOpen === false && snapshot.instrument_id.startsWith('MT5:') && !snapshot.instrument_id.includes(':CRYPTO:') && (
                <div style={{ fontSize: '9px', color: '#F59E0B', fontWeight: 700, marginTop: '1px' }}>
                  ⏸ Forex/Gold đóng cửa cuối tuần (Chế độ Test Lệnh trên Chart)
                </div>
              )}
            </div>

            {mt5Account.lastOrderFeedback && (
              <div
                style={{
                  background: mt5Account.lastOrderFeedback.ok ? 'rgba(8, 153, 129, 0.14)' : 'rgba(242, 54, 69, 0.16)',
                  border: `1px solid ${mt5Account.lastOrderFeedback.ok ? '#089981' : '#F23645'}`,
                  color: mt5Account.lastOrderFeedback.ok ? '#34D399' : '#FCA5A5',
                  borderRadius: '4px',
                  padding: '4px 6px',
                  fontSize: '9.5px',
                  fontWeight: 700,
                  lineHeight: 1.35,
                }}
              >
                {mt5Account.lastOrderFeedback.message}
              </div>
            )}

            {/* 2. ONE-CLICK TRADING SELL (BID) / BUY (ASK) BOXES (MT5 & TradingView Standard) */}
            <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
              {/* SELL BY MARKET (BID) */}
              <button
                onClick={() => handleMarketOrder('SELL')}
                style={{
                  background: 'linear-gradient(180deg, #F23645 0%, #C81E2B 100%)',
                  color: '#FFFFFF',
                  border: '1px solid #F87171',
                  borderRadius: '5px',
                  padding: '6px 6px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  boxShadow: '0 2px 8px rgba(242, 54, 69, 0.25)',
                }}
                title="Vào lệnh Bán trực tiếp (One-Click Sell Market tại giá Bid)"
              >
                <span style={{ fontSize: '9px', fontWeight: 800, opacity: 0.9, letterSpacing: '0.4px' }}>
                  SELL / BID
                </span>
                <span style={{ fontSize: '12.5px', fontWeight: 900, fontFamily: '"JetBrains Mono", monospace', marginTop: '1px' }}>
                  {formatInstrumentPrice(bestBidTicks, snapshot.instrument_id)}
                </span>
              </button>

              {/* BUY BY MARKET (ASK) */}
              <button
                onClick={() => handleMarketOrder('BUY')}
                style={{
                  background: 'linear-gradient(180deg, #089981 0%, #057A66 100%)',
                  color: '#FFFFFF',
                  border: '1px solid #34D399',
                  borderRadius: '5px',
                  padding: '6px 6px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-end',
                  boxShadow: '0 2px 8px rgba(8, 153, 129, 0.25)',
                }}
                title="Vào lệnh Mua trực tiếp (One-Click Buy Market tại giá Ask)"
              >
                <span style={{ fontSize: '9px', fontWeight: 800, opacity: 0.9, letterSpacing: '0.4px' }}>
                  BUY / ASK
                </span>
                <span style={{ fontSize: '12.5px', fontWeight: 900, fontFamily: '"JetBrains Mono", monospace', marginTop: '1px' }}>
                  {formatInstrumentPrice(bestAskTicks, snapshot.instrument_id)}
                </span>
              </button>

              {/* Center Spread Pill */}
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  background: '#131722',
                  border: '1px solid #363C4E',
                  borderRadius: '3px',
                  padding: '1px 5px',
                  fontSize: '8.5px',
                  fontWeight: 800,
                  color: '#CBD5E1',
                  fontFamily: 'monospace',
                  pointerEvents: 'none',
                }}
              >
                {spreadPips}
              </div>
            </div>

            {/* 3. ORDER TYPE TABS (Market | Limit | Stop) — TradingView & MT5 Standard */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                background: '#1E222D',
                borderRadius: '5px',
                padding: '2px',
                border: '1px solid #2A2E39',
              }}
            >
              {(
                [
                  { id: 'MARKET', label: 'Thị trường (MKT)' },
                  { id: 'LIMIT', label: 'Chờ Limit' },
                  { id: 'STOP', label: 'Chờ Stop' },
                ] as const
              ).map((t) => {
                const active = orderTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      setOrderTab(t.id);
                      if (t.id === 'LIMIT' || t.id === 'STOP') {
                        setEntryPriceTicks(currentPriceTicks);
                      }
                    }}
                    style={{
                      background: active ? '#2A2E39' : 'transparent',
                      color: active ? '#00E5FF' : '#94A3B8',
                      border: active ? '1px solid #363C4E' : '1px solid transparent',
                      borderRadius: '4px',
                      padding: '4px 2px',
                      fontSize: '10px',
                      fontWeight: active ? 800 : 600,
                      cursor: 'pointer',
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            {/* 4. ENTRY PRICE CONTROL (Shown when Limit or Stop Tab is Active) */}
            {(orderTab === 'LIMIT' || orderTab === 'STOP') && (
              <div
                style={{
                  background: '#1A1E29',
                  border: '1px solid #2E3546',
                  borderRadius: '5px',
                  padding: '6px 7px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '5px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: '#CBD5E1' }}>
                    Giá Đặt Lệnh ({orderTab})
                  </span>
                  <button
                    onClick={() => onRequestPickPriceOnChart?.(!isPickingPriceOnChart)}
                    style={{
                      background: isPickingPriceOnChart ? '#00E5FF' : 'rgba(0, 229, 255, 0.14)',
                      color: isPickingPriceOnChart ? '#090B10' : '#00E5FF',
                      border: '1px solid #00E5FF',
                      borderRadius: '3px',
                      padding: '1px 6px',
                      fontSize: '9.5px',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                    title="Bấm vào đây rồi click trực tiếp lên mức giá bất kỳ trên Biểu đồ"
                  >
                    {isPickingPriceOnChart ? '🎯 Click lên Chart...' : '🎯 Chọn trên Chart'}
                  </button>
                </div>

                {/* Price Stepper Row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button
                    onClick={() => setEntryPriceTicks((p) => Math.max(instMeta.tickSize, p - pipStep * 5))}
                    style={{
                      background: '#262B38',
                      color: '#E2E8F0',
                      border: '1px solid #363C4E',
                      borderRadius: '3px',
                      padding: '3px 7px',
                      fontSize: '11px',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    −
                  </button>
                  <input
                    type="text"
                    value={formatInstrumentPrice(entryPriceTicks, snapshot.instrument_id)}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val) && val > 0) {
                        const scale = Math.pow(10, instMeta.priceDecimals);
                        setEntryPriceTicks(Math.round(val * scale));
                      }
                    }}
                    style={{
                      flex: 1,
                      background: '#11141C',
                      border: '1px solid #363C4E',
                      borderRadius: '3px',
                      color: '#FFD600',
                      textAlign: 'center',
                      fontWeight: 800,
                      fontSize: '11.5px',
                      padding: '3px 4px',
                      fontFamily: '"JetBrains Mono", monospace',
                      outline: 'none',
                    }}
                  />
                  <button
                    onClick={() => setEntryPriceTicks((p) => p + pipStep * 5)}
                    style={{
                      background: '#262B38',
                      color: '#E2E8F0',
                      border: '1px solid #363C4E',
                      borderRadius: '3px',
                      padding: '3px 7px',
                      fontSize: '11px',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    +
                  </button>
                </div>

                {/* Quick Offset Pills */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '3px' }}>
                  {[
                    { lbl: 'Bid', fn: () => setEntryPriceTicks(bestBidTicks) },
                    { lbl: 'Ask', fn: () => setEntryPriceTicks(bestAskTicks) },
                    { lbl: '-20p', fn: () => setEntryPriceTicks(currentPriceTicks - 20 * pipStep) },
                    { lbl: '+20p', fn: () => setEntryPriceTicks(currentPriceTicks + 20 * pipStep) },
                  ].map((b) => (
                    <button
                      key={b.lbl}
                      onClick={b.fn}
                      style={{
                        background: '#222632',
                        color: '#94A3B8',
                        border: '1px solid #2E3444',
                        borderRadius: '3px',
                        padding: '2px 0',
                        fontSize: '9.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {b.lbl}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 5. VOLUME / LOT SIZE STEPPER & QUICK PRESETS */}
            <div
              style={{
                background: '#1A1E29',
                border: '1px solid #2A2E39',
                borderRadius: '5px',
                padding: '6px 7px',
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '10.5px', color: '#CBD5E1', fontWeight: 700 }}>
                  Khối Lượng (Lots)
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button
                    onClick={() => setOrderLots((l) => Math.max(0.01, Number((l - 0.1).toFixed(2))))}
                    style={{
                      background: '#262B38',
                      color: '#E2E8F0',
                      border: '1px solid #363C4E',
                      borderRadius: '3px',
                      width: '22px',
                      height: '20px',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    step={0.01}
                    min={0.01}
                    max={100}
                    value={orderLots}
                    onChange={(e) => setOrderLots(Math.max(0.01, parseFloat(e.target.value) || 0.01))}
                    style={{
                      width: '56px',
                      background: '#11141C',
                      border: '1px solid #363C4E',
                      borderRadius: '3px',
                      color: '#00E5FF',
                      textAlign: 'center',
                      fontWeight: 800,
                      fontSize: '11.5px',
                      fontFamily: 'monospace',
                      padding: '2px 2px',
                      outline: 'none',
                    }}
                  />
                  <button
                    onClick={() => setOrderLots((l) => Number((l + 0.1).toFixed(2)))}
                    style={{
                      background: '#262B38',
                      color: '#E2E8F0',
                      border: '1px solid #363C4E',
                      borderRadius: '3px',
                      width: '22px',
                      height: '20px',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Quick Lot Preset Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '3px' }}>
                {[0.01, 0.05, 0.1, 0.5, 1.0, 2.0].map((lv) => {
                  const isSel = Math.abs(orderLots - lv) < 0.001;
                  return (
                    <button
                      key={lv}
                      onClick={() => setOrderLots(lv)}
                      style={{
                        background: isSel ? 'rgba(0, 229, 255, 0.18)' : '#222632',
                        color: isSel ? '#00E5FF' : '#94A3B8',
                        border: isSel ? '1px solid #00E5FF' : '1px solid #2E3444',
                        borderRadius: '3px',
                        padding: '2px 0',
                        fontSize: '9.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: 'monospace',
                      }}
                    >
                      {lv}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 6. TAKE PROFIT & STOP LOSS BRACKET (TradingView Order Ticket Style) */}
            <div
              style={{
                background: '#1A1E29',
                border: '1px solid #2A2E39',
                borderRadius: '5px',
                padding: '6px 7px',
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px' }}>
                <span style={{ color: '#CBD5E1', fontWeight: 700 }}>Bảo Vệ Lệnh (SL / TP)</span>
                <span style={{ color: '#00E5FF', fontWeight: 800, fontFamily: 'monospace' }}>
                  R:R 1:{rrRatio}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                {/* Stop Loss Box */}
                <div
                  style={{
                    background: slEnabled ? 'rgba(242, 54, 69, 0.08)' : '#141720',
                    border: `1px solid ${slEnabled ? 'rgba(242, 54, 69, 0.45)' : '#262B38'}`,
                    borderRadius: '4px',
                    padding: '4px 6px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '3px',
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '9.5px', cursor: 'pointer' }}>
                    <span style={{ color: '#F87171', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <input
                        type="checkbox"
                        checked={slEnabled}
                        onChange={(e) => setSlEnabled(e.target.checked)}
                        style={{ margin: 0 }}
                      />
                      SL (Pips)
                    </span>
                    {slEnabled && (
                      <span style={{ color: '#FCA5A5', fontFamily: 'monospace', fontSize: '9px' }}>
                        -${estSlUsd.toFixed(0)}
                      </span>
                    )}
                  </label>
                  <input
                    type="number"
                    disabled={!slEnabled}
                    min={1}
                    max={5000}
                    value={slPips}
                    onChange={(e) => setSlPips(Math.max(1, parseInt(e.target.value, 10) || 10))}
                    style={{
                      width: '100%',
                      background: '#11141C',
                      border: '1px solid #2E3444',
                      borderRadius: '3px',
                      color: slEnabled ? '#FFFFFF' : '#64748B',
                      textAlign: 'center',
                      fontWeight: 800,
                      fontSize: '11px',
                      fontFamily: 'monospace',
                      padding: '2px 0',
                      outline: 'none',
                    }}
                  />
                </div>

                {/* Take Profit Box */}
                <div
                  style={{
                    background: tpEnabled ? 'rgba(8, 153, 129, 0.08)' : '#141720',
                    border: `1px solid ${tpEnabled ? 'rgba(8, 153, 129, 0.45)' : '#262B38'}`,
                    borderRadius: '4px',
                    padding: '4px 6px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '3px',
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '9.5px', cursor: 'pointer' }}>
                    <span style={{ color: '#34D399', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <input
                        type="checkbox"
                        checked={tpEnabled}
                        onChange={(e) => setTpEnabled(e.target.checked)}
                        style={{ margin: 0 }}
                      />
                      TP (Pips)
                    </span>
                    {tpEnabled && (
                      <span style={{ color: '#6EE7B7', fontFamily: 'monospace', fontSize: '9px' }}>
                        +${estTpUsd.toFixed(0)}
                      </span>
                    )}
                  </label>
                  <input
                    type="number"
                    disabled={!tpEnabled}
                    min={1}
                    max={10000}
                    value={tpPips}
                    onChange={(e) => setTpPips(Math.max(1, parseInt(e.target.value, 10) || 20))}
                    style={{
                      width: '100%',
                      background: '#11141C',
                      border: '1px solid #2E3444',
                      borderRadius: '3px',
                      color: tpEnabled ? '#FFFFFF' : '#64748B',
                      textAlign: 'center',
                      fontWeight: 800,
                      fontSize: '11px',
                      fontFamily: 'monospace',
                      padding: '2px 0',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              {/* Quick R:R Ratio Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '3px' }}>
                {[
                  { lbl: '1:1 R', mult: 1 },
                  { lbl: '1:2 R', mult: 2 },
                  { lbl: '1:3 R', mult: 3 },
                  { lbl: '1:5 R', mult: 5 },
                ].map((r) => (
                  <button
                    key={r.lbl}
                    onClick={() => {
                      setSlEnabled(true);
                      setTpEnabled(true);
                      setTpPips(slPips * r.mult);
                    }}
                    style={{
                      background: tpPips === slPips * r.mult ? 'rgba(16, 185, 129, 0.18)' : '#222632',
                      color: tpPips === slPips * r.mult ? '#34D399' : '#94A3B8',
                      border: '1px solid #2E3444',
                      borderRadius: '3px',
                      padding: '2px 0',
                      fontSize: '9px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {r.lbl}
                  </button>
                ))}
              </div>
            </div>

            {/* 7. PRIMARY ACTION BUTTONS FOR LIMIT / STOP ORDERS */}
            {orderTab !== 'MARKET' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                <button
                  onClick={() => handlePendingOrder('BUY')}
                  style={{
                    background: '#089981',
                    color: '#FFFFFF',
                    border: '1px solid #10B981',
                    borderRadius: '4px',
                    padding: '7px 4px',
                    fontSize: '10.5px',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  ĐẶT BUY {orderTab}
                </button>
                <button
                  onClick={() => handlePendingOrder('SELL')}
                  style={{
                    background: '#F23645',
                    color: '#FFFFFF',
                    border: '1px solid #F87171',
                    borderRadius: '4px',
                    padding: '7px 4px',
                    fontSize: '10.5px',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  ĐẶT SELL {orderTab}
                </button>
              </div>
            )}

            {/* 8. ATAS / CTRADER SCALPER QUICK TOOLS (Join Bid/Ask, Breakeven, Reverse, Cancel, Flatten) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
              <button
                onClick={() => handleJoinBidAsk('BUY')}
                style={{
                  background: '#1B2E2B',
                  color: '#34D399',
                  border: '1px solid #059669',
                  borderRadius: '3px',
                  padding: '4px 0',
                  fontSize: '10px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                title="Đặt Buy Limit ngay tại giá Best Bid hiện tại (Join Bid)"
              >
                + Join Bid
              </button>
              <button
                onClick={() => handleJoinBidAsk('SELL')}
                style={{
                  background: '#311B22',
                  color: '#FCA5A5',
                  border: '1px solid #DC2626',
                  borderRadius: '3px',
                  padding: '4px 0',
                  fontSize: '10px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                title="Đặt Sell Limit ngay tại giá Best Ask hiện tại (Join Ask)"
              >
                + Join Ask
              </button>

              <button
                onClick={() => mt5BridgeService.breakevenAll(snapshot.instrument_id)}
                style={{
                  background: '#1E2536',
                  color: '#38BDF8',
                  border: '1px solid #0284C7',
                  borderRadius: '3px',
                  padding: '4px 0',
                  fontSize: '10px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                title="Dời Stop Loss tất cả lệnh đang mở về đúng giá Entry (Hòa vốn - Breakeven)"
              >
                🛡 Hòa Vốn (BE)
              </button>
              <button
                onClick={() => mt5BridgeService.reverseAll(snapshot.instrument_id, currentPriceTicks)}
                style={{
                  background: '#262138',
                  color: '#C084FC',
                  border: '1px solid #7E22CE',
                  borderRadius: '3px',
                  padding: '4px 0',
                  fontSize: '10px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                title="Đóng vị thế hiện tại và vào lệnh ngược chiều ngay lập tức (Reverse)"
              >
                ⇄ Đảo Chiều
              </button>

              <button
                onClick={handleCancelAll}
                style={{
                  background: '#1E222D',
                  color: '#F97316',
                  border: '1px solid #F97316',
                  borderRadius: '3px',
                  padding: '5px 0',
                  fontSize: '10px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                title="Hủy tất cả lệnh chờ Limit / Stop"
              >
                ✕ Hủy Chờ ({pendingOrders.length})
              </button>
              <button
                onClick={handleFlattenAll}
                style={{
                  background: '#F97316',
                  color: '#FFFFFF',
                  border: '1px solid #F97316',
                  borderRadius: '3px',
                  padding: '5px 0',
                  fontSize: '10px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
                title="Đóng tất cả vị thế đang mở (Flatten All)"
              >
                ⚡ Đóng Hết ({openPositions.length})
              </button>
            </div>

            {/* 9. POSITION SUMMARY BAR (Open Lots, Open P/L, Floating P/L) */}
            <div
              style={{
                background: '#1A1E29',
                border: '1px solid #262B38',
                borderRadius: '4px',
                padding: '5px 7px',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
                fontSize: '10.5px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94A3B8' }}>Vị thế ròng (Net Lots)</span>
                <strong
                  style={{
                    color: netLots > 0 ? '#00E676' : netLots < 0 ? '#EF4444' : '#E2E8F0',
                    fontFamily: 'monospace',
                  }}
                >
                  {netLots > 0 ? `+${netLots.toFixed(2)}` : netLots.toFixed(2)} Lot
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94A3B8' }}>P/L Cặp Này</span>
                <strong
                  style={{
                    color: openPnlUsd > 0 ? '#00E676' : openPnlUsd < 0 ? '#EF4444' : '#E2E8F0',
                    fontFamily: 'monospace',
                  }}
                >
                  {openPnlUsd >= 0 ? '+' : ''}
                  {openPnlUsd.toFixed(2)} $
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94A3B8' }}>Tổng P/L Tài Khoản</span>
                <strong
                  style={{
                    color: dailyPnlUsd > 0 ? '#00E676' : dailyPnlUsd < 0 ? '#EF4444' : '#E2E8F0',
                    fontFamily: 'monospace',
                  }}
                >
                  {dailyPnlUsd >= 0 ? '+' : ''}
                  {dailyPnlUsd.toFixed(2)} $
                </strong>
              </div>
            </div>

            {/* 10. ACTIVE POSITIONS & PENDING ORDERS LIST (Interactive BE & Close) */}
            {(openPositions.length > 0 || pendingOrders.length > 0) && (
              <div
                style={{
                  background: '#171B24',
                  border: '1px solid #2A3040',
                  borderRadius: '4px',
                  padding: '5px 6px',
                  fontSize: '10px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#00E5FF', fontWeight: 800, marginBottom: '4px' }}>
                  <span>LỆNH ĐANG MỞ & CHỜ ({openPositions.length + pendingOrders.length})</span>
                  <span style={{ color: '#94A3B8', fontSize: '9px' }}>Kéo SL/TP trên Chart</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '170px', overflowY: 'auto' }}>
                  {[...openPositions, ...pendingOrders].map((tk) => {
                    const pnl =
                      tk.status === 'OPEN'
                        ? typeof tk.profitUsd === 'number'
                          ? tk.profitUsd
                          : computePositionPnlUsd(tk.side, tk.entryPriceTicks, currentPriceTicks, tk.lots, snapshot.instrument_id)
                        : 0;
                    return (
                      <div
                        key={tk.ticket}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '3px 4px',
                          background: '#1E2330',
                          borderRadius: '3px',
                          fontFamily: 'monospace',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                          <div>
                            <span style={{ color: tk.side === 'Buy' ? '#10B981' : '#EF4444', fontWeight: 800 }}>
                              {tk.side.toUpperCase()} {tk.lots}L
                            </span>{' '}
                            <span style={{ color: '#CBD5E1' }}>
                              @{formatInstrumentPrice(tk.entryPriceTicks, snapshot.instrument_id)}
                            </span>
                          </div>
                          <div style={{ fontSize: '8.5px', color: '#94A3B8' }}>
                            SL: {tk.slTicks ? formatInstrumentPrice(tk.slTicks, snapshot.instrument_id) : '---'} · TP:{' '}
                            {tk.tpTicks ? formatInstrumentPrice(tk.tpTicks, snapshot.instrument_id) : '---'}
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                          {tk.status === 'OPEN' ? (
                            <>
                              <span style={{ color: pnl >= 0 ? '#00E676' : '#EF4444', fontWeight: 700 }}>
                                {pnl >= 0 ? '+' : ''}
                                {pnl.toFixed(1)}$
                              </span>
                              <button
                                onClick={() => mt5BridgeService.setTicketBreakeven(tk.ticket)}
                                style={{
                                  background: '#1E3A5F',
                                  color: '#38BDF8',
                                  border: 'none',
                                  borderRadius: '2px',
                                  padding: '1px 4px',
                                  fontSize: '8.5px',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                }}
                                title="Dời SL về Hòa Vốn (Breakeven)"
                              >
                                BE
                              </button>
                            </>
                          ) : (
                            <span style={{ color: '#FFD600', fontSize: '9px' }}>{tk.orderType}</span>
                          )}
                          <button
                            onClick={() => mt5BridgeService.closeTicket(tk.ticket, currentPriceTicks)}
                            style={{
                              background: '#3B1E26',
                              color: '#FCA5A5',
                              border: 'none',
                              borderRadius: '2px',
                              padding: '1px 5px',
                              fontSize: '10px',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                            title="Đóng lệnh này"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'dom_tape' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ flex: '1 1 50%', minHeight: '220px', borderBottom: '1px solid #283241', overflow: 'hidden' }}>
              <DomLadderPanel
                orderBook={snapshot.order_book}
                activePriceTicks={currentPriceTicks}
                instrumentId={snapshot.instrument_id}
                isFloating={false}
                onPopOutToggle={onPopOutDom}
              />
            </div>
            <div style={{ flex: '1 1 50%', minHeight: '220px', overflow: 'hidden' }}>
              <TimeAndSalesTape
                trades={snapshot.recent_trades || []}
                instrumentId={snapshot.instrument_id}
                isFloating={false}
                onPopOutToggle={onPopOutTape}
              />
            </div>
          </div>
        )}

        {activeTab === 'dom' && (
          <DomLadderPanel
            orderBook={snapshot.order_book}
            activePriceTicks={currentPriceTicks}
            instrumentId={snapshot.instrument_id}
            isFloating={false}
            onPopOutToggle={onPopOutDom}
          />
        )}

        {activeTab === 'tape' && (
          <TimeAndSalesTape
            trades={snapshot.recent_trades || []}
            instrumentId={snapshot.instrument_id}
            isFloating={false}
            onPopOutToggle={onPopOutTape}
          />
        )}

        {activeTab === 'insights' && (
          <div style={{ padding: '12px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
            {narrative ? (
              <>
                <div
                  style={{
                    background: '#182231',
                    border: '1px solid #283241',
                    borderLeft: `3px solid ${narrative.sentiment === 'BULLISH' ? '#00D492' : '#FF4D6A'}`,
                    borderRadius: '6px',
                    padding: '10px 12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span
                      style={{
                        fontSize: '9.5px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        padding: '1px 6px',
                        borderRadius: '3px',
                        background: narrative.sentiment === 'BULLISH' ? 'rgba(0, 212, 146, 0.15)' : 'rgba(255, 77, 106, 0.15)',
                        color: narrative.sentiment === 'BULLISH' ? '#00D492' : '#FF4D6A',
                      }}
                    >
                      {narrative.sentiment}
                    </span>
                    <span style={{ fontSize: '10px', color: '#78889B' }}>REAL-TIME</span>
                  </div>
                  <strong style={{ fontSize: '12px', color: '#FFF', lineHeight: '1.4', display: 'block' }}>
                    {narrative.headline}
                  </strong>
                </div>

                <div style={{ background: '#182231', border: '1px solid #283241', borderRadius: '6px', padding: '10px 12px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#A78BFA', marginBottom: '6px', textTransform: 'uppercase' }}>
                    🌊 Dòng Lệnh Vi Mô (Order Flow)
                  </div>
                  <p style={{ margin: 0, fontSize: '11px', color: '#CFD8DC', lineHeight: '1.5' }}>
                    {narrative.order_flow_summary}
                  </p>
                </div>

                <div style={{ background: '#182231', border: '1px solid #283241', borderRadius: '6px', padding: '10px 12px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#00B4D8', marginBottom: '6px', textTransform: 'uppercase' }}>
                    🎯 Vùng Quyền Chọn (Options Confluence)
                  </div>
                  <p style={{ margin: '0 0 6px 0', fontSize: '11px', color: '#CFD8DC', lineHeight: '1.5' }}>
                    {narrative.options_confluence}
                  </p>
                  {options && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '10px', marginTop: '6px' }}>
                      <div style={{ background: '#0E131C', padding: '4px 6px', borderRadius: '4px' }}>
                        <span style={{ color: '#78889B' }}>PCR:</span>{' '}
                        <strong style={{ color: '#FFF' }}>{options.put_call_ratio.toFixed(2)}</strong>
                      </div>
                      <div style={{ background: '#0E131C', padding: '4px 6px', borderRadius: '4px' }}>
                        <span style={{ color: '#78889B' }}>Max Pain:</span>{' '}
                        <strong style={{ color: '#FDB022' }}>${(options.max_pain_ticks / 100).toLocaleString()}</strong>
                      </div>
                      <div style={{ background: '#0E131C', padding: '4px 6px', borderRadius: '4px' }}>
                        <span style={{ color: '#78889B' }}>Call Wall:</span>{' '}
                        <strong style={{ color: '#00D492' }}>${(options.call_wall_ticks / 100).toLocaleString()}</strong>
                      </div>
                      <div style={{ background: '#0E131C', padding: '4px 6px', borderRadius: '4px' }}>
                        <span style={{ color: '#78889B' }}>Put Wall:</span>{' '}
                        <strong style={{ color: '#FF4D6A' }}>${(options.put_wall_ticks / 100).toLocaleString()}</strong>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ color: '#78889B', textAlign: 'center', marginTop: '40px', fontSize: '12px' }}>
                Đang quét vi cấu trúc dòng lệnh...
              </div>
            )}
          </div>
        )}

        {activeTab === 'greeks' && (
          <div style={{ padding: '12px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#C084FC', textTransform: 'uppercase' }}>
                Options Greeks (Black-76)
              </span>
              <span style={{ fontSize: '10px', color: '#78889B' }}>Deribit Index</span>
            </div>

            {options ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '10.5px' }}>
                  <div style={{ background: '#182231', border: '1px solid #283241', padding: '6px 8px', borderRadius: '4px' }}>
                    <div style={{ color: '#78889B', fontSize: '9.5px' }}>ATM IV</div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#00B4D8' }}>
                      {((options.atm_iv || 0.55) * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div style={{ background: '#182231', border: '1px solid #283241', padding: '6px 8px', borderRadius: '4px' }}>
                    <div style={{ color: '#78889B', fontSize: '9.5px' }}>PCR (Vol/OI)</div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#FFF' }}>
                      {options.put_call_ratio.toFixed(2)}
                    </div>
                  </div>
                </div>

                <div style={{ background: '#182231', border: '1px solid #283241', borderRadius: '6px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '10px' }}>
                    <thead>
                      <tr style={{ background: '#0E131C', color: '#78889B', borderBottom: '1px solid #283241' }}>
                        <th style={{ textAlign: 'left', padding: '4px 6px' }}>Strike</th>
                        <th style={{ padding: '4px 4px', color: '#00D492' }}>Call Δ</th>
                        <th style={{ padding: '4px 4px', color: '#FF4D6A' }}>Put Δ</th>
                        <th style={{ padding: '4px 4px', color: '#FDB022' }}>Gamma</th>
                        <th style={{ padding: '4px 6px', color: '#00B4D8' }}>IV</th>
                      </tr>
                    </thead>
                    <tbody>
                      {options.strikes?.map((st) => (
                        <tr key={st.strike_ticks} style={{ borderBottom: '1px solid #1F2633' }}>
                          <td style={{ textAlign: 'left', padding: '3px 6px', color: '#FFF', fontWeight: 600 }}>
                            {(st.strike_ticks / 100).toLocaleString()}
                          </td>
                          <td style={{ padding: '3px 4px', color: '#00D492' }}>{st.call_delta.toFixed(2)}</td>
                          <td style={{ padding: '3px 4px', color: '#FF4D6A' }}>{st.put_delta.toFixed(2)}</td>
                          <td style={{ padding: '3px 4px', color: '#FDB022' }}>{st.call_gamma.toFixed(4)}</td>
                          <td style={{ padding: '3px 6px', color: '#00B4D8', fontWeight: 600 }}>
                            {(st.iv_smile * 100).toFixed(0)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div style={{ color: '#78889B', textAlign: 'center', marginTop: '30px', fontSize: '12px' }}>
                Chưa có dữ liệu Options.
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
