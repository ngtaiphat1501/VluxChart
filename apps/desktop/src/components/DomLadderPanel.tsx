import React, { useState, useMemo } from 'react';
import { OrderBookSnapshotDTO } from '../types';
import { CANONICAL_INSTRUMENTS, formatInstrumentPrice, formatPriceDiffPips, getInstrumentMeta } from '../utils/instrumentRegistry';

interface DomLadderPanelProps {
  orderBook?: OrderBookSnapshotDTO;
  priceTick?: number;
  activePriceTicks?: number;
  instrumentId?: string;
  onClose?: () => void;
  onPopOutToggle?: () => void;
  isFloating?: boolean;
}

export const DomLadderPanel: React.FC<DomLadderPanelProps> = ({
  orderBook,
  priceTick,
  activePriceTicks,
  instrumentId = 'BTC-USDT-PERP',
  onClose,
  onPopOutToggle,
  isFloating = false,
}) => {
  const [centerOffset, setCenterOffset] = useState<number>(0);
  const [tickMult, setTickMult] = useState<number>(1);

  const instMeta = getInstrumentMeta(instrumentId);
  const isBtc = instrumentId.includes('BTC');
  const isEth = instrumentId.includes('ETH');
  const qtyScale = isBtc ? 1000 : isEth ? 100 : instMeta.venue === 'MT5' ? 10 : 1;
  const unit = instMeta.venue === 'MT5' ? 'Lot' : isBtc ? 'BTC' : isEth ? 'ETH' : instrumentId.includes('XAU') ? 'OZ' : 'contracts';

  // Format quantities with appropriate precision
  const formatQty = (rawUnits: number) => {
    if (rawUnits <= 0) return '';
    const scaled = rawUnits / qtyScale;
    if (scaled >= 100) return Math.round(scaled).toLocaleString();
    if (scaled >= 10) return scaled.toFixed(1);
    if (scaled >= 1) return scaled.toFixed(2);
    return scaled.toFixed(3);
  };

  // Dynamically resolve mid price strictly from live market data or canonical instrument specification
  const canonicalBase = instrumentId ? CANONICAL_INSTRUMENTS[instrumentId]?.basePriceTicks : undefined;
  const fallbackMid = activePriceTicks || canonicalBase || 0;
  const bestBid = orderBook?.bids?.[0]?.price_ticks ?? (fallbackMid > 0 ? fallbackMid - 10 : 0);
  const bestAsk = orderBook?.asks?.[0]?.price_ticks ?? (fallbackMid > 0 ? fallbackMid + 10 : 0);
  const midPrice = (bestBid > 0 && bestAsk > 0) ? Math.round((bestBid + bestAsk) / 2) : fallbackMid;

  // Base tick size automatically derived from order book or instrument registry
  const baseTick = useMemo(() => {
    if (priceTick && priceTick > 0) return priceTick;
    if (orderBook?.bids && orderBook.bids.length >= 2) {
      const diff = Math.abs(orderBook.bids[0].price_ticks - orderBook.bids[1].price_ticks);
      if (diff > 0) return diff;
    }
    return 10;
  }, [priceTick, orderBook]);

  const effectiveTick = baseTick * tickMult;

  // Calculate totals and max level volume for bar normalization
  const { totalBidVol, totalAskVol, maxVol } = useMemo(() => {
    let tBid = 0;
    let tAsk = 0;
    let mVol = 1;
    orderBook?.bids?.forEach((b) => {
      tBid += b.quantity_units;
      if (b.quantity_units > mVol) mVol = b.quantity_units;
    });
    orderBook?.asks?.forEach((a) => {
      tAsk += a.quantity_units;
      if (a.quantity_units > mVol) mVol = a.quantity_units;
    });
    return { totalBidVol: tBid, totalAskVol: tAsk, maxVol: mVol };
  }, [orderBook]);

  // Generate 27 price rows strictly aligned to effectiveTick and aggregated
  const rows = useMemo(() => {
    const list = [];
    // Ensure center aligns exactly to an effectiveTick boundary
    const alignedMid = Math.round(midPrice / effectiveTick) * effectiveTick;
    const center = alignedMid + centerOffset * effectiveTick;

    // Bin and aggregate orderbook quantities into effectiveTick intervals
    const bidMap = new Map<number, number>();
    const askMap = new Map<number, number>();

    orderBook?.bids?.forEach((b) => {
      const binPrice = Math.floor(b.price_ticks / effectiveTick) * effectiveTick;
      bidMap.set(binPrice, (bidMap.get(binPrice) || 0) + b.quantity_units);
    });

    orderBook?.asks?.forEach((a) => {
      const binPrice = Math.ceil(a.price_ticks / effectiveTick) * effectiveTick;
      askMap.set(binPrice, (askMap.get(binPrice) || 0) + a.quantity_units);
    });

    for (let i = 13; i >= -13; i--) {
      const price = center + i * effectiveTick;
      const bQty = bidMap.get(price) || 0;
      const aQty = askMap.get(price) || 0;
      const isBestB = Math.abs(price - bestBid) < effectiveTick / 2;
      const isBestA = Math.abs(price - bestAsk) < effectiveTick / 2;

      list.push({
        price,
        bidQty: bQty,
        askQty: aQty,
        isBestBid: isBestB,
        isBestAsk: isBestA,
      });
    }
    return list;
  }, [midPrice, centerOffset, effectiveTick, orderBook, bestBid, bestAsk]);

  const bidRatioPct = totalBidVol + totalAskVol > 0
    ? Math.round((totalBidVol / (totalBidVol + totalAskVol)) * 100)
    : 50;

  return (
    <div
      style={{
        width: isFloating ? '100%' : '260px',
        height: '100%',
        background: '#131722',
        borderLeft: isFloating ? 'none' : '1px solid #2A2E39',
        display: 'flex',
        flexDirection: 'column',
        fontSize: '11px',
        color: '#E1E4EA',
        fontFamily: '"JetBrains Mono", monospace, system-ui',
      }}
    >
      {/* Header with Imbalance Meter & Controls */}
      <div
        style={{
          padding: '6px 8px',
          background: '#1E222D',
          borderBottom: '1px solid #2A2E39',
          display: 'flex',
          flexDirection: 'column',
          gap: '5px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontWeight: 700, color: '#00E5FF', fontSize: '11px' }}>🪜 DOM LADDER</span>
            <span style={{ fontSize: '10px', color: '#94A3B8' }}>
              Spr: {formatPriceDiffPips(Math.max(0, bestAsk - bestBid), instrumentId)}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {/* Tick Aggregation Mult Selector */}
            <div style={{ display: 'flex', background: '#131722', borderRadius: '3px', padding: '1px' }}>
              {[1, 2, 5, 10].map((m) => (
                <button
                  key={m}
                  onClick={() => setTickMult(m)}
                  style={{
                    background: tickMult === m ? '#00E5FF' : 'transparent',
                    color: tickMult === m ? '#000' : '#64748B',
                    border: 'none',
                    borderRadius: '2px',
                    padding: '1px 4px',
                    fontSize: '9px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {m}x
                </button>
              ))}
            </div>

            <button
              onClick={() => setCenterOffset(0)}
              style={{
                background: '#2A2E39',
                color: '#FFF',
                border: 'none',
                borderRadius: '3px',
                padding: '2px 5px',
                fontSize: '10px',
                cursor: 'pointer',
                fontWeight: 600,
              }}
              title="Center DOM Ladder on current mid price"
            >
              ⌖
            </button>
            {onPopOutToggle && (
              <button
                onClick={onPopOutToggle}
                style={{
                  background: '#2A2E39',
                  color: '#FFF',
                  border: 'none',
                  borderRadius: '3px',
                  padding: '2px 5px',
                  fontSize: '10px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
                title={isFloating ? 'Dock panel to sidebar' : 'Pop out into floating window'}
              >
                {isFloating ? '📌' : '↗'}
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                style={{
                  background: 'transparent',
                  color: '#8E9AA8',
                  border: 'none',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Depth Imbalance Bar with scaled units */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '9.5px' }}>
          <span style={{ color: '#089981', fontWeight: 700 }}>
            {(totalBidVol / qtyScale).toFixed(1)} {unit}
          </span>
          <div
            style={{
              flex: 1,
              height: '5px',
              background: '#2A2E39',
              borderRadius: '2px',
              overflow: 'hidden',
              display: 'flex',
            }}
          >
            <div style={{ width: `${bidRatioPct}%`, background: '#089981' }} />
            <div style={{ width: `${100 - bidRatioPct}%`, background: '#F23645' }} />
          </div>
          <span style={{ color: '#F23645', fontWeight: 700 }}>
            {(totalAskVol / qtyScale).toFixed(1)} {unit}
          </span>
        </div>
      </div>

      {/* Ladder Column Headers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 78px 1fr',
          padding: '4px 6px',
          background: '#161922',
          borderBottom: '1px solid #2A2E39',
          fontWeight: 700,
          color: '#64748B',
          fontSize: '9.5px',
          textAlign: 'center',
        }}
      >
        <span style={{ textAlign: 'left', paddingLeft: '4px', color: '#089981' }}>BID ({unit})</span>
        <span>PRICE</span>
        <span style={{ textAlign: 'right', paddingRight: '4px', color: '#F23645' }}>ASK ({unit})</span>
      </div>

      {/* Ladder Rows */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {rows.map((row) => {
          const bidWidthPct = maxVol > 0 ? (row.bidQty / maxVol) * 100 : 0;
          const askWidthPct = maxVol > 0 ? (row.askQty / maxVol) * 100 : 0;

          return (
            <div
              key={row.price}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 78px 1fr',
                height: '21px',
                alignItems: 'center',
                borderBottom: '1px solid rgba(42, 46, 57, 0.4)',
                background: row.isBestBid
                  ? 'rgba(8, 153, 129, 0.15)'
                  : row.isBestAsk
                  ? 'rgba(242, 54, 69, 0.15)'
                  : 'transparent',
                position: 'relative',
              }}
            >
              {/* Bid Volume Cell */}
              <div
                style={{
                  height: '100%',
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  paddingLeft: '6px',
                }}
              >
                {row.bidQty > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: 0,
                      bottom: 0,
                      width: `${bidWidthPct}%`,
                      background: 'rgba(8, 153, 129, 0.22)',
                      borderLeft: '2px solid #089981',
                    }}
                  />
                )}
                <span style={{ position: 'relative', zIndex: 1, color: '#089981', fontWeight: 600, fontSize: '10px' }}>
                  {formatQty(row.bidQty)}
                </span>
              </div>

              {/* Price Cell */}
              <div
                style={{
                  textAlign: 'center',
                  fontWeight: row.isBestBid || row.isBestAsk ? 700 : 500,
                  color: row.isBestBid ? '#089981' : row.isBestAsk ? '#F23645' : '#E2E8F0',
                  background: row.isBestBid || row.isBestAsk ? '#1E222D' : 'transparent',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderLeft: '1px solid #2A2E39',
                  borderRight: '1px solid #2A2E39',
                  fontSize: '10.5px',
                }}
              >
                {formatInstrumentPrice(row.price, instrumentId)}
              </div>

              {/* Ask Volume Cell */}
              <div
                style={{
                  height: '100%',
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  paddingRight: '6px',
                }}
              >
                {row.askQty > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${askWidthPct}%`,
                      background: 'rgba(242, 54, 69, 0.22)',
                      borderRight: '2px solid #F23645',
                    }}
                  />
                )}
                <span style={{ position: 'relative', zIndex: 1, color: '#F23645', fontWeight: 600, fontSize: '10px' }}>
                  {formatQty(row.askQty)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
