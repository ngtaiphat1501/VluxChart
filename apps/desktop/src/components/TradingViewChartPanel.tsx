import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  UTCTimestamp,
  CandlestickData,
  HistogramData,
} from 'lightweight-charts';
import { BarDTO, TradeEventDTO, VwapBandDTO } from '../types';
import { getInstrumentMeta } from '../utils/instrumentRegistry';

interface TradingViewChartPanelProps {
  bars: BarDTO[];
  activeBar: BarDTO | null;
  instrumentId: string;
  recentTrades?: TradeEventDTO[];
  vwap?: VwapBandDTO;
  timeframeUs?: number;
  onTimeframeChange?: (timeframeUs: number) => void;
  onSwitchToFootprint?: () => void;
  onLoadMoreHistory?: () => void;
}

export const TradingViewChartPanel: React.FC<TradingViewChartPanelProps> = ({
  bars,
  activeBar,
  instrumentId,
  recentTrades,
  vwap,
  timeframeUs = 60000000,
  onTimeframeChange,
  onSwitchToFootprint,
  onLoadMoreHistory,
}) => {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  const [hoveredCandle, setHoveredCandle] = useState<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    delta?: number;
  } | null>(null);

  const [showVolume, setShowVolume] = useState<boolean>(true);
  const [showVwapLine, setShowVwapLine] = useState<boolean>(true);

  const instMeta = useMemo(() => getInstrumentMeta(instrumentId), [instrumentId]);
  const tickScale = instMeta.tickScale || 100;

  // Combine and sort bars
  const combinedBars = useMemo(() => {
    const list = activeBar ? [...bars, activeBar] : [...bars];
    list.sort((a, b) => a.bar_start_us - b.bar_start_us);
    return list;
  }, [bars, activeBar]);

  // Current active display stats
  const currentDisplayBar = hoveredCandle || (activeBar
    ? {
        time: Math.floor(activeBar.bar_start_us / 1000000),
        open: activeBar.open_ticks / tickScale,
        high: activeBar.high_ticks / tickScale,
        low: activeBar.low_ticks / tickScale,
        close: activeBar.close_ticks / tickScale,
        volume: activeBar.total_units || 0,
        delta: activeBar.delta_units || 0,
      }
    : combinedBars.length > 0
    ? {
        time: Math.floor(combinedBars[combinedBars.length - 1].bar_start_us / 1000000),
        open: combinedBars[combinedBars.length - 1].open_ticks / tickScale,
        high: combinedBars[combinedBars.length - 1].high_ticks / tickScale,
        low: combinedBars[combinedBars.length - 1].low_ticks / tickScale,
        close: combinedBars[combinedBars.length - 1].close_ticks / tickScale,
        volume: combinedBars[combinedBars.length - 1].total_units || 0,
        delta: combinedBars[combinedBars.length - 1].delta_units || 0,
      }
    : null);

  // Initialize TradingView lightweight chart instance
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const container = chartContainerRef.current;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#0B0F15' },
        textColor: '#848E9C',
        fontSize: 12,
        fontFamily: "'JetBrains Mono', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.04)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.04)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(0, 229, 255, 0.5)',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#00B4D8',
        },
        horzLine: {
          color: 'rgba(0, 229, 255, 0.5)',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#00B4D8',
        },
      },
      rightPriceScale: {
        borderColor: '#1E293B',
        autoScale: true,
        scaleMargins: {
          top: 0.08,
          bottom: 0.2,
        },
        alignLabels: true,
      },
      timeScale: {
        borderColor: '#1E293B',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 10,
        minBarSpacing: 2,
      },
      handleScale: {
        axisPressedMouseMove: {
          time: true,
          price: true,
        },
        mouseWheel: true,
        pinch: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
    });

    chartInstanceRef.current = chart;

    // 1. Candlestick series with TradingView standard styling
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00E676',
      downColor: '#FF3366',
      borderVisible: false,
      wickUpColor: '#00E676',
      wickDownColor: '#FF3366',
      priceFormat: {
        type: 'price',
        precision: 2,
        minMove: 0.1,
      },
    });
    candleSeriesRef.current = candleSeries;

    // 2. Volume histogram overlay at the bottom
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '', // Overlay independent of price scale
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.82,
        bottom: 0,
      },
    });
    volumeSeriesRef.current = volumeSeries;

    // 3. VWAP line overlay
    const vwapSeries = chart.addSeries(LineSeries, {
      color: '#FFD600',
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
    });
    vwapSeriesRef.current = vwapSeries;

    // Crosshair move subscription for live HUD updates
    chart.subscribeCrosshairMove((param) => {
      if (
        !param.point ||
        !param.time ||
        param.point.x < 0 ||
        param.point.x > container.clientWidth ||
        param.point.y < 0 ||
        param.point.y > container.clientHeight
      ) {
        setHoveredCandle(null);
        return;
      }

      const candleData = param.seriesData.get(candleSeries) as CandlestickData<UTCTimestamp> | undefined;
      const volData = param.seriesData.get(volumeSeries) as HistogramData<UTCTimestamp> | undefined;

      if (candleData) {
        const timeSec = Number(param.time);
        // Find matching original bar to extract delta
        const matchingBar = combinedBars.find(
          (b) => Math.floor(b.bar_start_us / 1000000) === timeSec
        );

        setHoveredCandle({
          time: timeSec,
          open: candleData.open,
          high: candleData.high,
          low: candleData.low,
          close: candleData.close,
          volume: volData?.value || 0,
          delta: matchingBar?.delta_units,
        });
      }
    });

    // Auto-fetch continuous older bars when user scrolls back towards the past
    let isFetchingOlder = false;
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range && range.from < 30 && !isFetchingOlder && onLoadMoreHistory) {
        isFetchingOlder = true;
        onLoadMoreHistory();
        setTimeout(() => {
          isFetchingOlder = false;
        }, 1200);
      }
    });

    // Resize observer for responsive layout
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || !entries[0].contentRect) return;
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartInstanceRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      vwapSeriesRef.current = null;
    };
  }, []);

  // Update chart data whenever bars or activeBar changes
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;

    const seenTimes = new Set<number>();
    const candleData: CandlestickData<UTCTimestamp>[] = [];
    const volumeData: HistogramData<UTCTimestamp>[] = [];
    const vwapData: { time: UTCTimestamp; value: number }[] = [];

    // Filter, validate, and convert bars
    for (const b of combinedBars) {
      if (!b.open_ticks || !b.high_ticks || !b.low_ticks || !b.close_ticks) continue;
      const t = Math.floor(b.bar_start_us / 1000000) as UTCTimestamp;
      if (seenTimes.has(t)) continue;
      seenTimes.add(t);

      const open = b.open_ticks / tickScale;
      const high = b.high_ticks / tickScale;
      const low = b.low_ticks / tickScale;
      const close = b.close_ticks / tickScale;
      const isUp = close >= open;

      candleData.push({
        time: t,
        open,
        high,
        low,
        close,
      });

      if (showVolume) {
        volumeData.push({
          time: t,
          value: b.total_units || 0,
          color: isUp ? 'rgba(0, 230, 118, 0.45)' : 'rgba(255, 51, 102, 0.45)',
        });
      }

      if (showVwapLine && vwap && vwap.vwap_ticks > 0) {
        vwapData.push({
          time: t,
          value: vwap.vwap_ticks / tickScale,
        });
      }
    }

    try {
      candleSeriesRef.current.applyOptions({
        priceFormat: {
          type: 'price',
          precision: instMeta.priceDecimals,
          minMove: 1 / Math.pow(10, instMeta.priceDecimals),
        },
      });
      candleSeriesRef.current.setData(candleData);
      if (showVolume) {
        volumeSeriesRef.current.setData(volumeData);
      } else {
        volumeSeriesRef.current.setData([]);
      }

      if (vwapSeriesRef.current) {
        vwapSeriesRef.current.applyOptions({
          priceFormat: {
            type: 'price',
            precision: instMeta.priceDecimals,
            minMove: 1 / Math.pow(10, instMeta.priceDecimals),
          },
        });
        if (showVwapLine && vwapData.length > 0) {
          vwapSeriesRef.current.setData(vwapData);
        } else {
          vwapSeriesRef.current.setData([]);
        }
      }
    } catch (e) {
      console.warn('[TradingViewChart] setData error:', e);
    }
  }, [combinedBars, showVolume, showVwapLine, vwap, tickScale, instMeta.priceDecimals]);

  // Real-time update for incoming active trade updates
  useEffect(() => {
    if (!candleSeriesRef.current || !activeBar) return;
    try {
      const t = Math.floor(activeBar.bar_start_us / 1000000) as UTCTimestamp;
      const open = activeBar.open_ticks / tickScale;
      const high = activeBar.high_ticks / tickScale;
      const low = activeBar.low_ticks / tickScale;
      const close = activeBar.close_ticks / tickScale;
      const isUp = close >= open;

      candleSeriesRef.current.update({
        time: t,
        open,
        high,
        low,
        close,
      });

      if (showVolume && volumeSeriesRef.current) {
        volumeSeriesRef.current.update({
          time: t,
          value: activeBar.total_units || 0,
          color: isUp ? 'rgba(0, 230, 118, 0.45)' : 'rgba(255, 51, 102, 0.45)',
        });
      }
    } catch (e) {
      // ignore transient ordering update exceptions
    }
  }, [activeBar, showVolume, tickScale]);

  const handleResetScale = () => {
    if (chartInstanceRef.current) {
      chartInstanceRef.current.timeScale().resetTimeScale();
      chartInstanceRef.current.priceScale('right').applyOptions({ autoScale: true });
    }
  };

  const timeframes = [
    { label: '15s', value: 15000000 },
    { label: '1m', value: 60000000 },
    { label: '5m', value: 300000000 },
    { label: '15m', value: 900000000 },
    { label: '1h', value: 3600000000 },
  ];

  const formatPrice = (val: number | undefined) => {
    if (val === undefined || isNaN(val)) return '---';
    return val.toLocaleString('en-US', {
      minimumFractionDigits: instMeta.priceDecimals,
      maximumFractionDigits: instMeta.priceDecimals,
    });
  };

  const isUpClose = currentDisplayBar ? currentDisplayBar.close >= currentDisplayBar.open : true;
  const priceColor = isUpClose ? '#00E676' : '#FF3366';

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0B0F15', position: 'relative' }}>
      {/* Top Header HUD Bar */}
      <div
        style={{
          height: '34px',
          minHeight: '34px',
          background: '#0E131C',
          borderBottom: '1px solid #1E293B',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          fontSize: '11.5px',
          color: '#848E9C',
          userSelect: 'none',
          zIndex: 10,
        }}
      >
        {/* Left: View Switcher & OHLC Stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Chart View Switcher */}
          <div style={{ display: 'flex', background: '#121923', border: '1px solid #283241', borderRadius: '4px', padding: '1px' }}>
            <button
              style={{
                background: '#1F2C3F',
                color: '#00E5FF',
                border: 'none',
                borderRadius: '3px',
                padding: '2px 8px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
              title="Khung TradingView chuẩn: Kéo thả chart, co giãn trục giá và trục thời gian"
            >
              🕯 TRADINGVIEW
            </button>
            {onSwitchToFootprint && (
              <button
                onClick={onSwitchToFootprint}
                style={{
                  background: 'transparent',
                  color: '#78889B',
                  border: 'none',
                  borderRadius: '3px',
                  padding: '2px 8px',
                  fontSize: '11px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
                title="Chuyển sang biểu đồ nến cụm Footprint Order Flow"
              >
                👣 FOOTPRINT
              </button>
            )}
          </div>

          {/* Timeframe Selectors */}
          <div style={{ display: 'flex', background: '#121923', border: '1px solid #283241', borderRadius: '4px', padding: '1px' }}>
            {timeframes.map((tf) => (
              <button
                key={tf.value}
                onClick={() => onTimeframeChange?.(tf.value)}
                style={{
                  background: timeframeUs === tf.value ? '#1F2C3F' : 'transparent',
                  color: timeframeUs === tf.value ? '#00D492' : '#78889B',
                  border: 'none',
                  borderRadius: '3px',
                  padding: '2px 6px',
                  fontSize: '10.5px',
                  fontWeight: timeframeUs === tf.value ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                {tf.label}
              </button>
            ))}
          </div>

          {/* OHLCV Legend Display */}
          {currentDisplayBar && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: "'JetBrains Mono', monospace", fontSize: '11px' }}>
              <span>
                O: <span style={{ color: priceColor }}>{formatPrice(currentDisplayBar.open)}</span>
              </span>
              <span>
                H: <span style={{ color: priceColor }}>{formatPrice(currentDisplayBar.high)}</span>
              </span>
              <span>
                L: <span style={{ color: priceColor }}>{formatPrice(currentDisplayBar.low)}</span>
              </span>
              <span>
                C: <strong style={{ color: priceColor }}>{formatPrice(currentDisplayBar.close)}</strong>
              </span>
              <span>
                Vol: <span style={{ color: '#E2E8F0' }}>{Math.round(currentDisplayBar.volume).toLocaleString()}</span>
              </span>
              {currentDisplayBar.delta !== undefined && (
                <span>
                  Delta:{' '}
                  <span style={{ color: currentDisplayBar.delta >= 0 ? '#00E676' : '#FF3366', fontWeight: 600 }}>
                    {currentDisplayBar.delta >= 0 ? `+${currentDisplayBar.delta.toLocaleString()}` : currentDisplayBar.delta.toLocaleString()}
                  </span>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right: Feature Toggles & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Historical Load More */}
          {onLoadMoreHistory && (
            <button
              onClick={onLoadMoreHistory}
              style={{
                background: '#182231',
                color: '#00E5FF',
                border: '1px solid #283241',
                borderRadius: '4px',
                padding: '2px 8px',
                fontSize: '10.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              title="Tải thêm 200 nến cũ từ sàn Bybit"
            >
              ⏪ +200 Nến Cũ
            </button>
          )}

          {/* Volume Overlay Toggle */}
          <button
            onClick={() => setShowVolume((prev) => !prev)}
            style={{
              background: showVolume ? '#1F2C3F' : '#121923',
              color: showVolume ? '#00E676' : '#78889B',
              border: '1px solid #283241',
              borderRadius: '4px',
              padding: '2px 7px',
              fontSize: '10.5px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            📊 Vol
          </button>

          {/* VWAP Overlay Toggle */}
          <button
            onClick={() => setShowVwapLine((prev) => !prev)}
            style={{
              background: showVwapLine ? '#1F2C3F' : '#121923',
              color: showVwapLine ? '#FFD600' : '#78889B',
              border: '1px solid #283241',
              borderRadius: '4px',
              padding: '2px 7px',
              fontSize: '10.5px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ⚡ VWAP
          </button>

          {/* Auto-Scale / Fit Button */}
          <button
            onClick={handleResetScale}
            style={{
              background: '#182231',
              color: '#00D492',
              border: '1px solid #283241',
              borderRadius: '4px',
              padding: '2px 8px',
              fontSize: '10.5px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
            title="Tự động căn chỉnh vừa khung màn hình"
          >
            <span>⤢</span>
            <span>Vừa Khung</span>
          </button>
        </div>
      </div>

      {/* Main Lightweight Charts Canvas Container */}
      <div
        ref={chartContainerRef}
        style={{
          flex: 1,
          width: '100%',
          position: 'relative',
        }}
      />

      {/* Floating Bottom Scale Interaction Tip */}
      <div
        style={{
          position: 'absolute',
          bottom: '26px',
          left: '12px',
          background: 'rgba(14, 19, 28, 0.75)',
          backdropFilter: 'blur(4px)',
          border: '1px solid rgba(40, 50, 65, 0.5)',
          borderRadius: '4px',
          padding: '2px 8px',
          fontSize: '10px',
          color: '#64748B',
          pointerEvents: 'none',
          zIndex: 5,
          display: 'flex',
          gap: '8px',
        }}
      >
        <span>💡 <b>Kéo chart:</b> Di chuyển (Pan)</span>
        <span>•</span>
        <span><b>Kéo trục giá bên phải:</b> Co / Giãn độ cao</span>
        <span>•</span>
        <span><b>Kéo trục thời gian đáy:</b> Co / Giãn khoảng cách nến</span>
        <span>•</span>
        <span><b>Lăn chuột:</b> Phóng to / Thu nhỏ</span>
      </div>
    </div>
  );
};
