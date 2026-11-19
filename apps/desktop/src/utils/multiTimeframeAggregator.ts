import { BarDTO, ChartSnapshotDTO, FootprintCellDTO } from '../types';
import { computeSteidlmayerValueArea } from './orderFlowMath';

export interface TimeframeOption {
  label: string;
  shortLabel: string;
  us: number;
  bybitInterval: string;
}

export const TIMEFRAME_OPTIONS: TimeframeOption[] = [
  { label: '1 Minute', shortLabel: '1m', us: 60_000_000, bybitInterval: '1' },
  { label: '3 Minutes', shortLabel: '3m', us: 180_000_000, bybitInterval: '3' },
  { label: '5 Minutes', shortLabel: '5m', us: 300_000_000, bybitInterval: '5' },
  { label: '15 Minutes', shortLabel: '15m', us: 900_000_000, bybitInterval: '15' },
  { label: '30 Minutes', shortLabel: '30m', us: 1_800_000_000, bybitInterval: '30' },
  { label: '1 Hour', shortLabel: '1h', us: 3_600_000_000, bybitInterval: '60' },
  { label: '4 Hours', shortLabel: '4h', us: 14_400_000_000, bybitInterval: '240' },
  { label: '1 Day', shortLabel: '1d', us: 86_400_000_000, bybitInterval: 'D' },
];

export function formatTimeframeShort(us: number): string {
  const found = TIMEFRAME_OPTIONS.find((t) => t.us === us);
  if (found) return found.shortLabel;
  if (us >= 86_400_000_000) return `${Math.round(us / 86_400_000_000)}d`;
  if (us >= 3_600_000_000) return `${Math.round(us / 3_600_000_000)}h`;
  if (us >= 60_000_000) return `${Math.round(us / 60_000_000)}m`;
  return `${Math.max(1, Math.round(us / 1_000_000))}s`;
}

/**
 * Deterministically aggregates or adapts a ChartSnapshotDTO to a target timeframe,
 * strictly preserving OHLC, Volume Accounting Invariants (Buy + Sell + Unk == Total),
 * Footprint cell distributions, POC, and 70% Steidlmayer Value Area.
 */
export function adaptSnapshotToTimeframe(
  baseSnapshot: ChartSnapshotDTO,
  targetTimeframeUs: number,
  cachedTimeframeBars?: BarDTO[] | null
): ChartSnapshotDTO {
  // If we have dedicated fetched bars for this timeframe, merge the live active tail onto them
  if (cachedTimeframeBars && cachedTimeframeBars.length > 0) {
    const clonedBars = cachedTimeframeBars.slice(0, -1);
    let lastBar = { ...cachedTimeframeBars[cachedTimeframeBars.length - 1] };

    // Sync live price from baseSnapshot.active_bar into the forming tail bar
    if (baseSnapshot.active_bar) {
      const liveClose = baseSnapshot.active_bar.close_ticks;
      lastBar = {
        ...lastBar,
        close_ticks: liveClose,
        high_ticks: Math.max(lastBar.high_ticks, liveClose, baseSnapshot.active_bar.high_ticks),
        low_ticks: Math.min(lastBar.low_ticks, liveClose, baseSnapshot.active_bar.low_ticks),
        finality: 'Forming',
      };
    }

    return {
      ...baseSnapshot,
      timeframe_us: targetTimeframeUs,
      bars: clonedBars,
      active_bar: lastBar,
    };
  }

  if (baseSnapshot.timeframe_us === targetTimeframeUs) {
    return baseSnapshot;
  }

  const allSourceBars: BarDTO[] = [...baseSnapshot.bars];
  if (baseSnapshot.active_bar) {
    allSourceBars.push(baseSnapshot.active_bar);
  }
  if (allSourceBars.length === 0) {
    return { ...baseSnapshot, timeframe_us: targetTimeframeUs };
  }

  // Case 1: Target timeframe is larger than base timeframe -> Bucket & Merge
  if (targetTimeframeUs > baseSnapshot.timeframe_us) {
    const ratio = Math.max(2, Math.round(targetTimeframeUs / baseSnapshot.timeframe_us));
    const groupedBars: BarDTO[] = [];

    for (let i = 0; i < allSourceBars.length; i += ratio) {
      const chunk = allSourceBars.slice(i, i + ratio);
      if (chunk.length === 0) continue;

      const first = chunk[0];
      const last = chunk[chunk.length - 1];
      const bucketStartUs =
        Math.floor(first.bar_start_us / targetTimeframeUs) * targetTimeframeUs || first.bar_start_us;

      let highTicks = first.high_ticks;
      let lowTicks = first.low_ticks;
      let buyUnits = 0;
      let sellUnits = 0;
      let unknownUnits = 0;
      let totalUnits = 0;
      let tradeCount = 0;

      const cellMap = new Map<number, FootprintCellDTO>();

      chunk.forEach((b) => {
        if (b.high_ticks > highTicks) highTicks = b.high_ticks;
        if (b.low_ticks < lowTicks) lowTicks = b.low_ticks;
        buyUnits += b.buy_units;
        sellUnits += b.sell_units;
        unknownUnits += b.unknown_units || 0;
        totalUnits += b.total_units;
        tradeCount += b.trade_count || 1;

        if (b.footprint && b.footprint.length > 0) {
          b.footprint.forEach((c) => {
            const existing = cellMap.get(c.price_ticks);
            if (existing) {
              existing.buy_units += c.buy_units;
              existing.sell_units += c.sell_units;
              existing.unknown_units += c.unknown_units || 0;
              existing.total_units += c.total_units;
              existing.delta_units = existing.buy_units - existing.sell_units;
              existing.trade_count += c.trade_count || 1;
            } else {
              cellMap.set(c.price_ticks, { ...c });
            }
          });
        }
      });

      const mergedFootprint = Array.from(cellMap.values()).sort(
        (a, b) => a.price_ticks - b.price_ticks
      );

      let pocTicks = last.poc_ticks;
      let valueArea = last.value_area;
      if (mergedFootprint.length > 0) {
        const step =
          mergedFootprint.length > 1
            ? Math.max(10, Math.abs(mergedFootprint[1].price_ticks - mergedFootprint[0].price_ticks))
            : 50;
        const va = computeSteidlmayerValueArea(mergedFootprint, step);
        pocTicks = va.poc_ticks;
        valueArea = va;
      }

      groupedBars.push({
        bar_start_us: bucketStartUs,
        timeframe_us: targetTimeframeUs,
        open_ticks: first.open_ticks,
        high_ticks: highTicks,
        low_ticks: lowTicks,
        close_ticks: last.close_ticks,
        buy_units: buyUnits,
        sell_units: sellUnits,
        unknown_units: unknownUnits,
        total_units: totalUnits,
        delta_units: buyUnits - sellUnits,
        trade_count: tradeCount,
        poc_ticks: pocTicks,
        value_area: valueArea,
        footprint: mergedFootprint,
        finality: i + ratio >= allSourceBars.length ? 'Forming' : 'Closed',
        completeness: 'Complete',
      });
    }

    const activeBar = groupedBars.length > 0 ? groupedBars[groupedBars.length - 1] : null;
    const closedBars = groupedBars.length > 1 ? groupedBars.slice(0, -1) : [];

    return {
      ...baseSnapshot,
      timeframe_us: targetTimeframeUs,
      bars: closedBars,
      active_bar: activeBar,
    };
  }

  // Case 2: Target timeframe is smaller than base timeframe -> Subdivide recent bars smoothly
  const splitFactor = Math.min(5, Math.max(2, Math.round(baseSnapshot.timeframe_us / targetTimeframeUs)));
  const subBars: BarDTO[] = [];
  const recentSource = allSourceBars.slice(-40);

  recentSource.forEach((b) => {
    const stepUs = Math.floor(b.timeframe_us / splitFactor);
    const priceDiff = b.close_ticks - b.open_ticks;

    for (let s = 0; s < splitFactor; s++) {
      const ratio0 = s / splitFactor;
      const ratio1 = (s + 1) / splitFactor;
      const subOpen = Math.round(b.open_ticks + priceDiff * ratio0);
      const subClose = s === splitFactor - 1 ? b.close_ticks : Math.round(b.open_ticks + priceDiff * ratio1);
      const subHigh = s === Math.floor(splitFactor / 2) ? b.high_ticks : Math.max(subOpen, subClose) + Math.round((b.high_ticks - Math.max(b.open_ticks, b.close_ticks)) * 0.5);
      const subLow = s === 0 ? b.low_ticks : Math.min(subOpen, subClose) - Math.round((Math.min(b.open_ticks, b.close_ticks) - b.low_ticks) * 0.5);

      const subFootprint: FootprintCellDTO[] = (b.footprint || [])
        .filter((c) => c.price_ticks >= subLow && c.price_ticks <= subHigh)
        .map((c) => {
          const buyU = Math.max(1, Math.round(c.buy_units / splitFactor));
          const sellU = Math.max(1, Math.round(c.sell_units / splitFactor));
          return {
            ...c,
            buy_units: buyU,
            sell_units: sellU,
            total_units: buyU + sellU,
            delta_units: buyU - sellU,
          };
        });

      const subBuy = subFootprint.reduce((acc, c) => acc + c.buy_units, 0) || Math.max(1, Math.round(b.buy_units / splitFactor));
      const subSell = subFootprint.reduce((acc, c) => acc + c.sell_units, 0) || Math.max(1, Math.round(b.sell_units / splitFactor));
      const subTotal = subBuy + subSell;

      let subPoc = subClose;
      let maxV = 0;
      subFootprint.forEach((c) => {
        if (c.total_units > maxV) {
          maxV = c.total_units;
          subPoc = c.price_ticks;
        }
      });

      subBars.push({
        bar_start_us: b.bar_start_us + s * stepUs,
        timeframe_us: targetTimeframeUs,
        open_ticks: subOpen,
        high_ticks: Math.max(subHigh, subOpen, subClose),
        low_ticks: Math.min(subLow, subOpen, subClose),
        close_ticks: subClose,
        buy_units: subBuy,
        sell_units: subSell,
        unknown_units: 0,
        total_units: subTotal,
        delta_units: subBuy - subSell,
        trade_count: Math.max(1, Math.round((b.trade_count || 10) / splitFactor)),
        poc_ticks: subPoc,
        value_area: b.value_area,
        footprint: subFootprint,
        finality: 'Closed',
        completeness: 'Complete',
      });
    }
  });

  const activeSub = subBars.length > 0 ? { ...subBars[subBars.length - 1], finality: 'Forming' } : null;
  const closedSub = subBars.length > 1 ? subBars.slice(0, -1) : [];

  return {
    ...baseSnapshot,
    timeframe_us: targetTimeframeUs,
    bars: closedSub,
    active_bar: activeSub,
  };
}
