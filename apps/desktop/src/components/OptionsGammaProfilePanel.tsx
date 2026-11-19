import React, { useRef, useEffect, useState, useMemo } from 'react';
import { OptionsSummaryDTO } from '../types';
import {
  optionsLiveService,
  LiveOptionsChainResult,
  OptionsExpiryFilter,
  EnrichedStrikeMetrics,
} from '../services/optionsLiveService';

interface OptionsGammaProfilePanelProps {
  instrumentId?: string;
  optionsSummary?: OptionsSummaryDTO;
  minPrice: number;
  maxPrice: number;
  chartHeight: number;
  panY: number;
  currentPriceTicks?: number | null;
  onHoverStrike?: (strike: number | null) => void;
  hoveredStrike?: number | null;
}

export const OptionsGammaProfilePanel: React.FC<OptionsGammaProfilePanelProps> = ({
  instrumentId = 'BYBIT:LINEAR_PERP:BTCUSDT:PERP',
  minPrice,
  maxPrice,
  chartHeight,
  panY,
  currentPriceTicks,
  onHoverStrike,
  hoveredStrike,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [internalHover, setInternalHover] = useState<number | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState<OptionsExpiryFilter>('ALL');
  const [scaleMode, setScaleMode] = useState<'ladder' | 'sync_chart'>('ladder');
  const [liveChain, setLiveChain] = useState<LiveOptionsChainResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
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
    const timer = setInterval(loadChain, 30_000);
    return () => {
      isCancelled = true;
      clearInterval(timer);
    };
  }, [instrumentId, selectedExpiry]);

  // Filter visible strikes in Ladder Mode (±16% around Spot, up to 22 closest active strikes)
  const displayStrikes: EnrichedStrikeMetrics[] = useMemo(() => {
    if (!liveChain || !liveChain.isRealData || liveChain.strikes.length === 0) return [];
    const spotTicks =
      currentPriceTicks && currentPriceTicks > 0
        ? currentPriceTicks
        : Math.round(liveChain.underlyingPrice * 100);

    if (scaleMode === 'sync_chart' && maxPrice > minPrice) {
      const inBounds = liveChain.strikes.filter(
        (s) => s.strike_ticks >= minPrice * 0.96 && s.strike_ticks <= maxPrice * 1.04
      );
      if (inBounds.length >= 3) {
        return inBounds;
      }
    }

    // Ladder Mode: Select the 22 strikes closest to current Spot price, sorted ascending (drawn top-to-bottom descending)
    const sortedByDist = [...liveChain.strikes]
      .filter((s) => s.call_oi + s.put_oi > 0)
      .sort((a, b) => Math.abs(a.strike_ticks - spotTicks) - Math.abs(b.strike_ticks - spotTicks))
      .slice(0, 22);

    return sortedByDist.sort((a, b) => a.strike_ticks - b.strike_ticks);
  }, [liveChain, currentPriceTicks, scaleMode, minPrice, maxPrice]);

  const maxMetrics = useMemo(() => {
    let maxGex = 1;
    let maxCpSum = 10;
    let maxCpDiff = 10;
    let maxOi = 10;

    displayStrikes.forEach((s) => {
      const absGex = Math.max(Math.abs(s.net_gex_usd), Math.abs(s.call_gex_usd), Math.abs(s.put_gex_usd));
      if (absGex > maxGex) maxGex = absGex;

      const sumVol = Math.max(s.call_vol, s.put_vol, 1);
      const diffVol = Math.abs(s.call_vol - s.put_vol);
      const oiMax = Math.max(s.call_oi, s.put_oi, 1);

      if (sumVol > maxCpSum) maxCpSum = sumVol;
      if (diffVol > maxCpDiff) maxCpDiff = diffVol;
      if (oiMax > maxOi) maxOi = oiMax;
    });

    return { maxGex, maxCpSum, maxCpDiff, maxOi };
  }, [displayStrikes]);

  const inspectedStrikeObj = useMemo(() => {
    const target = hoveredStrike ?? internalHover;
    if (!target || displayStrikes.length === 0) return displayStrikes[Math.floor(displayStrikes.length / 2)] || null;
    return displayStrikes.find((s) => s.strike_ticks === target) || null;
  }, [displayStrikes, hoveredStrike, internalHover]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // DeepChart Obsidian Background
    ctx.fillStyle = '#0B0D12';
    ctx.fillRect(0, 0, width, height);

    if (isLoading && !liveChain) {
      ctx.fillStyle = '#38BDF8';
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ĐANG TẢI DỮ LIỆU OPTIONS THỰC TẾ TỪ SÀN DERIBIT...', width / 2, height / 2);
      return;
    }

    if (!liveChain || !liveChain.isRealData || displayStrikes.length === 0) {
      ctx.fillStyle = '#F59E0B';
      ctx.font = 'bold 11px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('SÀN MT5 FOREX/CFD KHÔNG CÔNG KHAI SỔ LỆNH OPTIONS', width / 2, height / 2 - 10);
      ctx.fillStyle = '#94A3B8';
      ctx.font = '10px "Inter", sans-serif';
      ctx.fillText('(Chuyển sang BTCUSDT hoặc ETHUSDT để xem 1,000+ Hợp đồng Options thật từ Deribit)', width / 2, height / 2 + 10);
      return;
    }

    const strikeAxisW = 62;
    const plotWidth = width - strikeAxisW;
    const colCount = 4;
    const colWidth = plotWidth / colCount;
    const effectiveH = height;

    // Determine Y coordinate mapping:
    // If scaleMode === 'sync_chart' and chart has enough strikes in range, use chart's priceToY.
    // Otherwise use uniform institutional Strike Ladder rows from highest strike (top) to lowest strike (bottom).
    const minStrike = displayStrikes[0].strike_ticks;
    const maxStrike = displayStrikes[displayStrikes.length - 1].strike_ticks;
    const useChartSync =
      scaleMode === 'sync_chart' &&
      maxPrice > minPrice &&
      maxPrice - minPrice >= (maxStrike - minStrike) * 0.25;

    const topPad = 18;
    const botPad = 18;
    const usableH = Math.max(100, effectiveH - topPad - botPad);

    const strikeToY = (strikeTicks: number, idx?: number) => {
      if (useChartSync) {
        const effChartH = chartHeight > 100 ? chartHeight : effectiveH;
        const norm = (strikeTicks - minPrice) / Math.max(1, maxPrice - minPrice);
        return effChartH - norm * effChartH + panY;
      }
      if (idx !== undefined && displayStrikes.length > 1) {
        // Descending order from top (highest strike) to bottom (lowest strike)
        const revIdx = displayStrikes.length - 1 - idx;
        return topPad + (revIdx / (displayStrikes.length - 1)) * usableH;
      }
      const norm = (strikeTicks - minStrike) / Math.max(1, maxStrike - minStrike);
      return topPad + (1 - norm) * usableH;
    };

    // Column backgrounds, borders, and vertical dashed zero-lines
    for (let c = 0; c < colCount; c++) {
      const x = strikeAxisW + c * colWidth;
      const centerX = x + colWidth / 2;

      if (c % 2 === 1) {
        ctx.fillStyle = 'rgba(20, 25, 36, 0.35)';
        ctx.fillRect(x, 0, colWidth, effectiveH);
      }

      ctx.strokeStyle = '#1E2532';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, effectiveH);
      ctx.stroke();

      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.20)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(centerX, 0);
      ctx.lineTo(centerX, effectiveH);
      ctx.stroke();
      ctx.restore();
    }

    // Left Strike Price Axis Column background
    ctx.fillStyle = '#0E121A';
    ctx.fillRect(0, 0, strikeAxisW, effectiveH);
    ctx.strokeStyle = '#1E2532';
    ctx.beginPath();
    ctx.moveTo(strikeAxisW, 0);
    ctx.lineTo(strikeAxisW, effectiveH);
    ctx.stroke();

    const rowGap = displayStrikes.length > 1 ? usableH / (displayStrikes.length - 1) : 18;
    const barH = Math.max(5, Math.min(13, rowGap * 0.68));

    // Render Each Real Deribit Option Strike Row
    displayStrikes.forEach((strike, idx) => {
      const y = strikeToY(strike.strike_ticks, idx);
      if (y < -15 || y > effectiveH + 15) return;

      const isCallWall = strike.strike_ticks === liveChain.callWallStrikeTicks;
      const isPutWall = strike.strike_ticks === liveChain.putWallStrikeTicks;
      const isZeroGamma = strike.strike_ticks === liveChain.zeroGammaStrikeTicks;
      const isMaxPain = strike.strike_ticks === liveChain.maxPainStrikeTicks;
      const isHovered =
        hoveredStrike === strike.strike_ticks || internalHover === strike.strike_ticks;

      // Subtle row grid line
      ctx.strokeStyle = isCallWall
        ? 'rgba(0, 230, 118, 0.28)'
        : isPutWall
        ? 'rgba(168, 85, 247, 0.28)'
        : '#141822';
      ctx.lineWidth = isCallWall || isPutWall ? 1.2 : 0.8;
      ctx.beginPath();
      ctx.moveTo(strikeAxisW, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      if (isHovered) {
        ctx.fillStyle = 'rgba(0, 229, 255, 0.14)';
        ctx.fillRect(0, y - barH / 2 - 2, width, barH + 4);
      }

      // Left Axis: Strike Price + Wall Badge
      const strikePriceUsd = Math.round(strike.strike_ticks / 100);
      ctx.font =
        isCallWall || isPutWall || isHovered
          ? 'bold 9.5px "JetBrains Mono", monospace'
          : '600 9px "JetBrains Mono", monospace';
      ctx.fillStyle = isCallWall
        ? '#00E676'
        : isPutWall
        ? '#C084FC'
        : isZeroGamma
        ? '#FFD600'
        : isHovered
        ? '#00E5FF'
        : '#94A3B8';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`$${strikePriceUsd.toLocaleString()}`, strikeAxisW - 5, y);

      if (isCallWall || isPutWall || isMaxPain) {
        const tag = isCallWall ? 'CW' : isPutWall ? 'PW' : 'MP';
        ctx.fillStyle = isCallWall ? '#00E676' : isPutWall ? '#A855F7' : '#F59E0B';
        ctx.fillRect(2, y - 5, 14, 10);
        ctx.fillStyle = '#07090E';
        ctx.font = 'bold 7px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(tag, 9, y);
      }

      const halfCol = colWidth / 2 - 5;

      // ─── Col 1: GEX (Net Gamma Exposure per 1% move) ───
      const col1Center = strikeAxisW + colWidth * 0.5;
      const gexW = Math.max(2, Math.min(Math.abs(strike.net_gex_usd) / maxMetrics.maxGex, 1.0) * halfCol);
      if (strike.net_gex_usd >= 0) {
        ctx.fillStyle = '#00E676';
        ctx.fillRect(col1Center, y - barH / 2, gexW, barH);
      } else {
        ctx.fillStyle = '#A855F7';
        ctx.fillRect(col1Center - gexW, y - barH / 2, gexW, barH);
      }

      // ─── Col 2: C/P Σ (Real 24h Call Volume Right, Put Volume Left) ───
      const col2Center = strikeAxisW + colWidth * 1.5;
      const callVolW = Math.max(2, Math.min(strike.call_vol / maxMetrics.maxCpSum, 1.0) * halfCol);
      const putVolW = Math.max(2, Math.min(strike.put_vol / maxMetrics.maxCpSum, 1.0) * halfCol);
      ctx.fillStyle = '#00E676';
      ctx.fillRect(col2Center, y - barH / 2, callVolW, barH);
      ctx.fillStyle = '#A855F7';
      ctx.fillRect(col2Center - putVolW, y - barH / 2, putVolW, barH);

      // ─── Col 3: C/P Δ (Real Net Call - Put Volume Delta) ───
      const col3Center = strikeAxisW + colWidth * 2.5;
      const cpDelta = strike.call_vol - strike.put_vol;
      const deltaW = Math.max(2, Math.min(Math.abs(cpDelta) / maxMetrics.maxCpDiff, 1.0) * halfCol);
      if (cpDelta >= 0) {
        ctx.fillStyle = '#00E676';
        ctx.fillRect(col3Center, y - barH / 2, deltaW, barH);
      } else {
        ctx.fillStyle = '#A855F7';
        ctx.fillRect(col3Center - deltaW, y - barH / 2, deltaW, barH);
      }

      // ─── Col 4: C/P OI (Real Call Open Interest Right, Put Open Interest Left) ───
      const col4Center = strikeAxisW + colWidth * 3.5;
      const callOiW = Math.max(2, Math.min(strike.call_oi / maxMetrics.maxOi, 1.0) * halfCol);
      const putOiW = Math.max(2, Math.min(strike.put_oi / maxMetrics.maxOi, 1.0) * halfCol);
      ctx.fillStyle = '#00E676';
      ctx.fillRect(col4Center, y - barH / 2, callOiW, barH);
      ctx.fillStyle = '#A855F7';
      ctx.fillRect(col4Center - putOiW, y - barH / 2, putOiW, barH);
    });

    // Draw Current Spot Price Reference Line across the Strike Ladder
    const spotPriceTicks =
      currentPriceTicks && currentPriceTicks > 0
        ? currentPriceTicks
        : Math.round(liveChain.underlyingPrice * 100);

    if (spotPriceTicks >= minStrike && spotPriceTicks <= maxStrike) {
      // Interpolate Y position of Spot between the two bounding strikes
      let spotY = strikeToY(spotPriceTicks);
      if (!useChartSync && displayStrikes.length > 1) {
        for (let i = 0; i < displayStrikes.length - 1; i++) {
          const s0 = displayStrikes[i].strike_ticks;
          const s1 = displayStrikes[i + 1].strike_ticks;
          if (spotPriceTicks >= s0 && spotPriceTicks <= s1) {
            const y0 = strikeToY(s0, i);
            const y1 = strikeToY(s1, i + 1);
            const t = (spotPriceTicks - s0) / Math.max(1, s1 - s0);
            spotY = y0 + t * (y1 - y0);
            break;
          }
        }
      }

      if (spotY >= 0 && spotY <= effectiveH) {
        ctx.save();
        ctx.strokeStyle = '#F8FAFC';
        ctx.lineWidth = 1.3;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, spotY);
        ctx.lineTo(width, spotY);
        ctx.stroke();
        ctx.setLineDash([]);

        const priceStr = (spotPriceTicks / 100).toFixed(1);
        ctx.fillStyle = '#A855F7';
        ctx.fillRect(1, spotY - 8, strikeAxisW - 2, 16);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(priceStr, strikeAxisW / 2, spotY);
        ctx.restore();
      }
    }
  }, [
    displayStrikes,
    liveChain,
    isLoading,
    minPrice,
    maxPrice,
    chartHeight,
    panY,
    currentPriceTicks,
    hoveredStrike,
    internalHover,
    maxMetrics,
    scaleMode,
  ]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || displayStrikes.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const topPad = 18;
    const botPad = 18;
    const usableH = Math.max(100, rect.height - topPad - botPad);

    let closestStrike = displayStrikes[0].strike_ticks;
    let minDiff = Infinity;

    displayStrikes.forEach((s, idx) => {
      const revIdx = displayStrikes.length - 1 - idx;
      const rowY = topPad + (revIdx / Math.max(1, displayStrikes.length - 1)) * usableH;
      const d = Math.abs(mouseY - rowY);
      if (d < minDiff) {
        minDiff = d;
        closestStrike = s.strike_ticks;
      }
    });

    setInternalHover(closestStrike);
    onHoverStrike?.(closestStrike);
  };

  const handleMouseLeave = () => {
    setInternalHover(null);
    onHoverStrike?.(null);
  };

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: '#0B0D12',
        borderLeft: '1px solid #1E2532',
        userSelect: 'none',
        position: 'relative',
      }}
    >
      {/* Top Bar 1: Expiry Filter + Scale Toggle + Real Data Source Status */}
      <div
        style={{
          height: '28px',
          background: '#0E121A',
          borderBottom: '1px solid #1E2532',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px',
          fontSize: '10px',
        }}
      >
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
          {(['ALL', '0DTE', 'WEEKLY', 'MONTHLY'] as const).map((exp) => (
            <button
              key={exp}
              onClick={() => setSelectedExpiry(exp)}
              style={{
                background: selectedExpiry === exp ? '#1E293B' : 'transparent',
                color: selectedExpiry === exp ? '#00E676' : '#64748B',
                border: `1px solid ${selectedExpiry === exp ? '#00E676' : 'transparent'}`,
                borderRadius: '3px',
                padding: '1px 5px',
                fontSize: '9px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {exp}
            </button>
          ))}

          <button
            onClick={() => setScaleMode((m) => (m === 'ladder' ? 'sync_chart' : 'ladder'))}
            style={{
              marginLeft: '4px',
              background: scaleMode === 'ladder' ? 'rgba(56, 189, 248, 0.16)' : '#1E293B',
              color: scaleMode === 'ladder' ? '#38BDF8' : '#94A3B8',
              border: '1px solid #283548',
              borderRadius: '3px',
              padding: '1px 6px',
              fontSize: '8.5px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
            title="Chuyển đổi giữa: Hiển thị đầy đủ chuỗi 22 Strike quanh giá Spot (Full Chain) ⇄ Đồng bộ trục Y với khung biểu đồ"
          >
            {scaleMode === 'ladder' ? '📊 22 Strikes' : '🔗 Sync Y'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: '6px', fontSize: '9px', fontWeight: 700, alignItems: 'center' }}>
          <span
            style={{
              color: liveChain?.isRealData ? '#00E676' : '#F59E0B',
              background: liveChain?.isRealData ? 'rgba(0, 230, 118, 0.12)' : 'rgba(245, 158, 11, 0.12)',
              padding: '1px 5px',
              borderRadius: '3px',
              border: `1px solid ${liveChain?.isRealData ? 'rgba(0,230,118,0.35)' : 'rgba(245,158,11,0.35)'}`,
            }}
            title={liveChain?.sourceName}
          >
            {liveChain?.isRealData
              ? liveChain.currency === 'XAU'
                ? `🟢 MULTI-EXCHANGE GOLD (${liveChain.totalContractsCount} HĐ)`
                : `🟢 4-EXCHANGE LIVE (${liveChain.totalContractsCount} HĐ)`
              : '⚠️ N/A FOREX'}
          </span>
        </div>
      </div>

      {/* Top Bar 2: Key Institutional Summary Strip (Call Wall | Put Wall | Max Pain | P/C Ratio) */}
      {liveChain?.isRealData && (
        <div
          style={{
            height: '22px',
            background: '#111622',
            borderBottom: '1px solid #1E2532',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 8px',
            fontSize: '9px',
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          <span>
            CW: <strong style={{ color: '#00E676' }}>${(liveChain.callWallStrikeTicks / 100).toLocaleString()}</strong>
          </span>
          <span>
            PW: <strong style={{ color: '#C084FC' }}>${(liveChain.putWallStrikeTicks / 100).toLocaleString()}</strong>
          </span>
          <span>
            MP: <strong style={{ color: '#FBBF24' }}>${(liveChain.maxPainStrikeTicks / 100).toLocaleString()}</strong>
          </span>
          <span>
            P/C: <strong style={{ color: '#38BDF8' }}>{liveChain.putCallRatio}</strong>
          </span>
        </div>
      )}

      {/* Main 4-Column Strike Profile Canvas */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />

        {/* Floating Real Strike Inspection Card on Hover */}
        {inspectedStrikeObj && liveChain?.isRealData && (
          <div
            style={{
              position: 'absolute',
              top: '6px',
              right: '6px',
              background: 'rgba(11, 13, 18, 0.94)',
              border: '1px solid #283548',
              borderRadius: '4px',
              padding: '5px 8px',
              fontSize: '9.5px',
              fontFamily: '"JetBrains Mono", monospace',
              color: '#E2E8F0',
              pointerEvents: 'none',
              boxShadow: '0 4px 14px rgba(0,0,0,0.65)',
            }}
          >
            <div style={{ color: '#00E5FF', fontWeight: 800, marginBottom: '2px' }}>
              STRIKE: ${(inspectedStrikeObj.strike_ticks / 100).toLocaleString()} ({selectedExpiry}) · IV: {inspectedStrikeObj.avg_iv}%
            </div>
            <div>
              CALL OI: <span style={{ color: '#00E676', fontWeight: 700 }}>{inspectedStrikeObj.call_oi.toLocaleString()} {liveChain.currency}</span>
              {' · '}
              PUT OI: <span style={{ color: '#C084FC', fontWeight: 700 }}>{inspectedStrikeObj.put_oi.toLocaleString()} {liveChain.currency}</span>
            </div>
            <div>
              24H VOL: <span style={{ color: '#00E676' }}>C:{inspectedStrikeObj.call_vol.toLocaleString()}</span>
              {' / '}
              <span style={{ color: '#C084FC' }}>P:{inspectedStrikeObj.put_vol.toLocaleString()}</span>
              {' · '}
              NET GEX:{' '}
              <span
                style={{
                  color: inspectedStrikeObj.net_gex_usd >= 0 ? '#00E676' : '#C084FC',
                  fontWeight: 700,
                }}
              >
                {inspectedStrikeObj.net_gex_usd >= 0 ? '+' : ''}${(inspectedStrikeObj.net_gex_usd / 1000).toFixed(1)}K
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Authentic DeepChart Bottom 4-Column Header Bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '62px repeat(4, 1fr)',
          height: '26px',
          background: '#0A0D14',
          borderTop: '1px solid #1E2634',
          fontSize: '10px',
          fontWeight: 700,
          color: '#E2E8F0',
          textAlign: 'center',
          lineHeight: '26px',
          letterSpacing: '0.2px',
        }}
      >
        <div style={{ borderRight: '1px solid #1E2532', color: '#94A3B8' }}>STRIKE</div>
        <div style={{ borderRight: '1px solid #1E2532' }}>GEX (γ)</div>
        <div style={{ borderRight: '1px solid #1E2532' }}>C/P Σ Vol</div>
        <div style={{ borderRight: '1px solid #1E2532' }}>C/P Δ Vol</div>
        <div>C/P OI</div>
      </div>
    </div>
  );
};
