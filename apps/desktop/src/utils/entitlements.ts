/**
 * DeepChart / VluxChart — 3-Tier Account Privilege & Entitlements Engine
 *
 * Enforces deterministic feature access across the 3 desktop license tiers:
 *   1. STANDARD PILOT    — Core Candles, Footprint (OF-B/A, OF-VP), Session D-VP, VWAP, CVD/VOL, Single Chart, Full Data Pack
 *   2. INSTITUTIONAL PRO — Unlocks Gold/Crypto Options (OPT/GEX & Board), Top 7 Quant Zones, FRVP, TPO Profile,
 *                          Cluster Search, Unfinished Auction, Multi-Chart (2V/2H/4), MT5 Live Execution & Risk Manager, Replay
 *   3. QUANT DESK        — 100% Unlocked: adds CME/L3 MBO Suite (Icebergs/StopRuns/Sweeps), Strategy Backtester & Optimizer,
 *                          Script Editor, Instrument Studio, and Raw Footprint CSV Export
 */

export type AccountTierId = 'STANDARD PILOT' | 'INSTITUTIONAL PRO' | 'QUANT DESK';

export type FeatureEntitlementKey =
  | 'top7_zones'
  | 'options_gex'
  | 'fixed_range_vp'
  | 'tpo_profile'
  | 'cluster_search'
  | 'unfinished_auction'
  | 'multi_chart'
  | 'mt5_execution'
  | 'risk_manager'
  | 'market_replay'
  | 'mbo_l3'
  | 'backtester'
  | 'script_editor'
  | 'instrument_studio'
  | 'csv_export';

export interface FeatureEntitlementDef {
  key: FeatureEntitlementKey;
  minTier: AccountTierId;
  title: string;
  shortDesc: string;
}

const TIER_RANK: Record<AccountTierId, number> = {
  'STANDARD PILOT': 1,
  'INSTITUTIONAL PRO': 2,
  'QUANT DESK': 3,
};

export const FEATURE_ENTITLEMENTS: Record<FeatureEntitlementKey, FeatureEntitlementDef> = {
  top7_zones: {
    key: 'top7_zones',
    minTier: 'INSTITUTIONAL PRO',
    title: 'Top 7 Vùng Mua/Bán Định Lượng (Backtested)',
    shortDesc: 'Đường vùng cung/cầu định lượng tối ưu riêng cho Vàng XAUUSD & Crypto.',
  },
  options_gex: {
    key: 'options_gex',
    minTier: 'INSTITUTIONAL PRO',
    title: 'Gold & Crypto Options Call/Put + Dealer GEX',
    shortDesc: 'Call Wall, Put Wall, Zero Gamma Flip & Max Pain thực tế (OPRA/CBOE Vàng Rust Native & Deribit).',
  },
  fixed_range_vp: {
    key: 'fixed_range_vp',
    minTier: 'INSTITUTIONAL PRO',
    title: 'Fixed Range Volume Profile (FRVP)',
    shortDesc: 'Kéo tay 2 điểm đo POC, 70% Value Area (VAH/VAL) và tổng Delta trên mọi vùng sóng.',
  },
  tpo_profile: {
    key: 'tpo_profile',
    minTier: 'INSTITUTIONAL PRO',
    title: 'TPO Market Profile (IBH/IBL & Single Prints)',
    shortDesc: 'Hồ sơ thị trường CBOT 30 phút/kỳ (A–Z), biên độ 60 phút đầu phiên và vùng Single Print.',
  },
  cluster_search: {
    key: 'cluster_search',
    minTier: 'INSTITUTIONAL PRO',
    title: 'ATAS Cluster Search (Dò Cụm Volume Cá Mập)',
    shortDesc: 'Tự động đóng khung các ô Footprint khớp lệnh tổ chức đột biến gấp ≥ 2.6 lần trung bình.',
  },
  unfinished_auction: {
    key: 'unfinished_auction',
    minTier: 'INSTITUTIONAL PRO',
    title: 'Unfinished Auction Detector (Đấu Giá Dở Dang)',
    shortDesc: 'Phát hiện các đỉnh/đáy nến chưa cạn kiệt thanh khoản (nam châm hút giá quay lại).',
  },
  multi_chart: {
    key: 'multi_chart',
    minTier: 'INSTITUTIONAL PRO',
    title: 'Multi-Chart Đa Khung Song Song (2V / 2H / 4 Ô)',
    shortDesc: 'Quan sát đồng thời M1 + M5 + M15 + H1 với con trỏ đồng bộ Crosshair Sync.',
  },
  mt5_execution: {
    key: 'mt5_execution',
    minTier: 'INSTITUTIONAL PRO',
    title: 'Kết Nối & Đặt Lệnh Sống MetaTrader 5',
    shortDesc: 'Cầu nối 1-Click thực thi lệnh Market/Limit/Stop và kéo SL/TP trực tiếp sang MT5.',
  },
  risk_manager: {
    key: 'risk_manager',
    minTier: 'INSTITUTIONAL PRO',
    title: 'Institutional Risk Manager (Khóa Lỗ Tự Động)',
    shortDesc: 'Tự động khóa quyền vào lệnh khi chạm hạn mức lỗ ngày hoặc vượt số lệnh tối đa.',
  },
  market_replay: {
    key: 'market_replay',
    minTier: 'INSTITUTIONAL PRO',
    title: 'Market Replay (Tua Lại Lịch Sử Order Flow)',
    shortDesc: 'Luyện tập đọc Footprint và kiểm chứng điểm vào lệnh từng nến theo tốc độ tùy chỉnh.',
  },
  mbo_l3: {
    key: 'mbo_l3',
    minTier: 'QUANT DESK',
    title: 'MBO Level-3 Suite (Iceberg, Stop Runs, Sweeps)',
    shortDesc: 'Theo dõi lệnh tảng băng ẩn (Iceberg), quét dừng lỗ liên hoàn và lệnh càn quét HFT.',
  },
  backtester: {
    key: 'backtester',
    minTier: 'QUANT DESK',
    title: 'Order Flow Strategy Backtester & Optimizer',
    shortDesc: 'Chạy kiểm thử định lượng hàng nghìn tham số và xuất đường cong vốn Equity Curve.',
  },
  script_editor: {
    key: 'script_editor',
    minTier: 'QUANT DESK',
    title: 'Custom Order Flow Script Editor',
    shortDesc: 'Môi trường viết công thức định lượng và tín hiệu cảnh báo Order Flow riêng.',
  },
  instrument_studio: {
    key: 'instrument_studio',
    minTier: 'QUANT DESK',
    title: 'Instrument Studio (Synthetic Spreads)',
    shortDesc: 'Thiết lập cặp giao dịch tổng hợp và cấu hình bước giá Tick chuyên sâu.',
  },
  csv_export: {
    key: 'csv_export',
    minTier: 'QUANT DESK',
    title: 'Trích Xuất Dữ Liệu Thô Footprint (CSV)',
    shortDesc: 'Xuất toàn bộ ma trận Bid × Ask từng mức giá ra CSV phục vụ nghiên cứu ML/Quant.',
  },
};

export function normalizeAccountTier(rawTier?: string | null): AccountTierId {
  const up = (rawTier || '').trim().toUpperCase();
  if (up.includes('QUANT')) return 'QUANT DESK';
  if (up.includes('PRO') || up.includes('INSTITUTIONAL')) return 'INSTITUTIONAL PRO';
  return 'STANDARD PILOT';
}

export function getTierRank(rawTier?: string | null): number {
  return TIER_RANK[normalizeAccountTier(rawTier)];
}

export function hasFeatureAccess(
  rawTier: string | undefined | null,
  featureKey: FeatureEntitlementKey
): boolean {
  const def = FEATURE_ENTITLEMENTS[featureKey];
  if (!def) return true;
  return getTierRank(rawTier) >= TIER_RANK[def.minTier];
}

export interface TierBadgeMeta {
  id: AccountTierId;
  shortBadge: 'PILOT' | 'PRO' | 'QUANT';
  displayName: string;
  textColor: string;
  bgColor: string;
  borderColor: string;
}

export function getTierBadgeMeta(rawTier?: string | null): TierBadgeMeta {
  const id = normalizeAccountTier(rawTier);
  if (id === 'QUANT DESK') {
    return {
      id,
      shortBadge: 'QUANT',
      displayName: 'QUANT DESK',
      textColor: '#FBBF24',
      bgColor: 'rgba(245, 158, 11, 0.16)',
      borderColor: 'rgba(245, 158, 11, 0.55)',
    };
  }
  if (id === 'INSTITUTIONAL PRO') {
    return {
      id,
      shortBadge: 'PRO',
      displayName: 'INSTITUTIONAL PRO',
      textColor: '#10B981',
      bgColor: 'rgba(16, 185, 129, 0.16)',
      borderColor: 'rgba(16, 185, 129, 0.55)',
    };
  }
  return {
    id,
    shortBadge: 'PILOT',
    displayName: 'STANDARD PILOT',
    textColor: '#94A3B8',
    bgColor: 'rgba(148, 163, 184, 0.14)',
    borderColor: 'rgba(148, 163, 184, 0.38)',
  };
}
