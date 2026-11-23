import React, { useState } from 'react';

export interface IndicatorConfigState {
  // Sub-Panels (Cửa sổ phụ độc lập bên dưới biểu đồ)
  showVolHistogram: boolean;
  showCvdPanel: boolean;
  showCotGrid: boolean;

  // Footprint / Cluster Overlays
  showOfBa: boolean;
  showOfVp: boolean;
  showOfDeltaP: boolean;
  showBarHeadStats: boolean;

  // Structure & HTF Reference Levels
  showPriorDayLevels: boolean;
  showVolumeProfile: boolean;
  showValueAreaLines: boolean;
  showVwap: boolean;
  showNakedPoc: boolean;
  showStackedImbalances: boolean;
  showPropZoneLines?: boolean;

  // Liquidity & Depth
  showSlClusters: boolean;
  showAbsorption: boolean;
  showOptions: boolean;
  showBubbles: boolean;
  showHeatmap: boolean;
  showChartDom?: boolean;

  // MBO Bundle (Market-by-Order CME & Crypto L3)
  showIcebergs?: boolean;
  showStopRuns?: boolean;
  showSweeps?: boolean;

  // Options Suite (Deribit Live & Analytical Greeks)
  showOptionsExpectedMove?: boolean;
  showRiskManager?: boolean;
}

export interface IndicatorsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: IndicatorConfigState;
  onChangeConfig: (updates: Partial<IndicatorConfigState>) => void;
  onApplyPreset: (presetName: 'atas_standard' | 'scalper_flow' | 'macro_institutional' | 'clean_price') => void;
}

interface IndicatorItemDef {
  key: keyof IndicatorConfigState;
  name: string;
  shortCode: string;
  category: 'sub_panels' | 'clusters' | 'structure' | 'liquidity' | 'mbo' | 'options';
  zone: 'Sub-Panel' | 'Chart Overlay';
  zoneDesc: string;
  badge: string;
  formula: string;
  description: string;
}

const INDICATOR_CATALOG: IndicatorItemDef[] = [
  // ─── 1. SUB-PANELS ───
  {
    key: 'showVolHistogram',
    name: 'Volume Histogram (Khối lượng từng phiên)',
    shortCode: 'VOL',
    category: 'sub_panels',
    zone: 'Sub-Panel',
    zoneDesc: 'Cửa sổ phụ độc lập bên dưới biểu đồ với trục Y riêng (0 - Max)',
    badge: 'ATAS Core',
    formula: 'V_bar = Σ (Vol_buy + Vol_sell)',
    description:
      'Biểu đồ cột thể hiện tổng khối lượng thực tế của từng cây nến, phân màu theo Delta mua/bán với trục Y độc lập bên phải.',
  },
  {
    key: 'showCvdPanel',
    name: 'Cumulative Volume Delta (CVD tích lũy)',
    shortCode: 'CVD',
    category: 'sub_panels',
    zone: 'Sub-Panel',
    zoneDesc: 'Cửa sổ phụ bên dưới với đường cong delta liên tục',
    badge: 'ATAS Core',
    formula: 'CVD_t = CVD_{t-1} + (Ask_vol - Bid_vol)',
    description:
      'Đường cong delta tích lũy liên tục qua các phiên. Giúp phát hiện phân kỳ đỉnh/đáy (Absorption và Exhaustion) khi giá tạo đỉnh mới nhưng CVD tạo đáy.',
  },
  {
    key: 'showCotGrid',
    name: 'COT Tape Matrix (Bảng ma trận delta 4 hàng)',
    shortCode: 'COT/Δ',
    category: 'sub_panels',
    zone: 'Sub-Panel',
    zoneDesc: 'Cửa sổ phụ dạng bảng nhiệt dưới chân chart',
    badge: 'DeepChart',
    formula: 'Rows: [COT Bar, Δ Qty, Δ %, Δ Vol]',
    description:
      'Bảng ma trận 4 hàng hiển thị dòng lệnh chi tiết dưới chân biểu đồ với màu nhiệt tương phản cao (High Contrast 10:1), đọc vị xung lực mua/bán ngay lập tức.',
  },

  // ─── 2. FOOTPRINT CLUSTERS ───
  {
    key: 'showOfBa',
    name: 'Footprint Bid × Ask Clusters & POC Box',
    shortCode: 'OF-B/A',
    category: 'clusters',
    zone: 'Chart Overlay',
    zoneDesc: 'Lớp phủ trực tiếp bên trong từng cây nến Footprint',
    badge: 'Order Flow',
    formula: 'Cell = Bid (Market Sells) × Ask (Market Buys)',
    description:
      'Hiển thị con số dòng lệnh khớp vi mô theo từng mức giá kèm khung vàng bao bọc mức giá tích lũy khối lượng lớn nhất (Point of Control - POC).',
  },
  {
    key: 'showOfVp',
    name: 'Footprint Cluster Volume Profile Bars',
    shortCode: 'OF-VP',
    category: 'clusters',
    zone: 'Chart Overlay',
    zoneDesc: 'Dải thanh ngang phân phối khối lượng trong lòng nến',
    badge: 'Order Flow',
    formula: 'BarWidth ∝ (Vol_level / MaxVol_bar)',
    description:
      'Dải thanh ngang phân phối khối lượng ngay trong lòng mỗi nến, giúp nhận diện sự dồn nén thanh khoản và sự chấp thuận giá của thị trường.',
  },
  {
    key: 'showOfDeltaP',
    name: 'Footprint Bi-Directional Delta Profile',
    shortCode: 'OF-ΔP',
    category: 'clusters',
    zone: 'Chart Overlay',
    zoneDesc: 'Profile delta lưỡng hướng tách biệt Buy và Sell trong nến',
    badge: 'Order Flow',
    formula: 'Δ_level = Ask_level - Bid_level',
    description:
      'Dải profile lưỡng hướng tách biệt phe Mua chủ động (xanh lá sang phải) và phe Bán chủ động (đỏ sang trái) trên từng mức giá.',
  },
  {
    key: 'showBarHeadStats',
    name: 'Bar Head Summary Stats (Delta & Vol đỉnh nến)',
    shortCode: 'HEAD Δ/V',
    category: 'clusters',
    zone: 'Chart Overlay',
    zoneDesc: 'Nhãn thông số đặt phía trên đỉnh mỗi cây nến',
    badge: 'Visual Aid',
    formula: 'Top: Delta | Bottom: Total Volume',
    description:
      'Nhãn thông số tóm tắt Delta và Tổng khối lượng đặt ngay phía trên râu nến cao nhất, giúp đọc nhanh giá trị mà không cần nhìn xuống cửa sổ phụ.',
  },

  // ─── 3. STRUCTURE & HTF LEVELS ───
  {
    key: 'showPriorDayLevels',
    name: 'HTF Prior Day Reference Levels (PDH, PDL, PDPOC, VA)',
    shortCode: 'HTF-PD',
    category: 'structure',
    zone: 'Chart Overlay',
    zoneDesc: 'Đường ngang kéo dài từ ngày hôm trước trên biểu đồ',
    badge: 'HTF Structure',
    formula: 'Group UTC Day: PDH, PDL, PDPOC, 70% Value Area [PDVAH, PDVAL]',
    description:
      'Các mốc tham chiếu quan trọng của ngày hôm trước: Đỉnh, Đáy, POC ngày trước, VAH/VAL 70%. Giúp nhận biết phiên hiện tại mở cửa bên trong hay bên ngoài Value Area.',
  },
  {
    key: 'showVolumeProfile',
    name: 'Session Volume Profile (D-VP bên phải)',
    shortCode: 'D-VP',
    category: 'structure',
    zone: 'Chart Overlay',
    zoneDesc: 'Cột volume profile phiên neo cố định bên phải chart',
    badge: 'Market Profile',
    formula: 'Session VP = Σ Vol per tick level across 24h trading day',
    description:
      'Profile phân phối khối lượng toàn phiên giao dịch (24h) neo ở mép phải chart, hiển thị rõ ràng High Volume Nodes (HVN) và Low Volume Nodes (LVN).',
  },
  {
    key: 'showValueAreaLines',
    name: 'Session VAH / VAL & POC Rays (D-VL)',
    shortCode: 'D-VL',
    category: 'structure',
    zone: 'Chart Overlay',
    zoneDesc: 'Tia ngang vàng/xanh hiển thị VAH, VAL và POC của phiên',
    badge: 'Market Profile',
    formula: 'VAH (70% top), VAL (70% bottom), POC (Peak Volume Level)',
    description:
      'Hiển thị các đường tia ngang ranh giới Value Area 70% của phiên hiện tại, gồm Point of Control (POC), Value Area High (VAH), Value Area Low (VAL).',
  },
  {
    key: 'showVwap',
    name: 'Developing Session VWAP & StDev Bands',
    shortCode: 'VWAP',
    category: 'structure',
    zone: 'Chart Overlay',
    zoneDesc: 'Đường cong giá trị trung bình theo khối lượng và dải độ lệch chuẩn',
    badge: 'Institutional',
    formula: 'VWAP = Σ (Price × Volume) / Σ Volume | Bands = VWAP ± k·σ',
    description:
      'Đường giá bình quân gia quyền theo khối lượng (VWAP) kèm 3 dải độ lệch chuẩn (±1σ, ±2σ, ±3σ). Dùng làm mức hồi quy giá trị công bằng chuẩn mực của quỹ đầu tư.',
  },
  {
    key: 'showNakedPoc',
    name: 'Naked POC Rays (NPOC chưa được kiểm định)',
    shortCode: 'NPOC',
    category: 'structure',
    zone: 'Chart Overlay',
    zoneDesc: 'Tia ngang kéo dài từ các POC quá khứ chưa bị giá chạm tới',
    badge: 'Smart Money',
    formula: 'Ray from historic bar POC that has NOT been breached by price',
    description:
      'Tia ngang kéo dài từ các POC của các phiên trước chưa từng bị giá quay lại chạm vào. Hoạt động như nam châm hút thanh khoản mạnh mẽ.',
  },
  {
    key: 'showStackedImbalances',
    name: 'Stacked Imbalances (Vùng dồn mất cân đối ≥ 3 mức)',
    shortCode: 'STK-IMB',
    category: 'structure',
    zone: 'Chart Overlay',
    zoneDesc: 'Khối hộp chữ nhật mở rộng sang phải đánh dấu vùng cản',
    badge: 'Order Flow',
    formula: '≥ 3 consecutive diagonal imbalances (Ratio ≥ 3.0)',
    description:
      'Tự động phát hiện khi có từ 3 mức giá liên tiếp xuất hiện mất cân đối chéo quyết liệt. Vẽ hộp vùng hỗ trợ/kháng cự mở rộng sang phải.',
  },
  {
    key: 'showPropZoneLines',
    name: 'Top 5 Vùng Mua/Bán Line Ngang Độc Quyền (Backtested)',
    shortCode: 'TOP5-LN',
    category: 'structure',
    zone: 'Chart Overlay',
    zoneDesc: 'Các đường line ngang Xanh (Vùng Mua) & Đỏ (Vùng Bán) kèm nhãn thống kê',
    badge: 'VluxChart Quant',
    formula: 'NPOC-MAG (PF 2.07) | ABS-WALL (PF 2.00) | VWAP-2SD (1.68) | STK-ZONE (1.59) | VA-EDGE (1.53)',
    description:
      'Tổng hợp Top 5 chỉ báo xác định vùng Mua/Bán tiềm năng bằng line ngang đã được backtest trên 2,895 nến M5 thực tế (MT5 XAUUSD, EURUSD, BTCUSD & Binance Futures) với R:R 1:2.',
  },

  // ─── 4. LIQUIDITY & DEPTH ───
  {
    key: 'showSlClusters',
    name: 'Stop-Loss Clusters & Liquidity Pools (S/LIQ)',
    shortCode: 'S/LIQ',
    category: 'liquidity',
    zone: 'Chart Overlay',
    zoneDesc: 'Vùng thanh khoản dừng lỗ của đám đông trên đỉnh/đáy',
    badge: 'Liquidity',
    formula: 'Equal Highs/Lows liquidity pools & estimated retail stop clusters',
    description:
      'Nhận diện các vùng tập trung lệnh cắt lỗ của đám đông (Buy-Side Liquidity & Sell-Side Liquidity) tại các đỉnh/đáy bằng phẳng (EQH/EQL).',
  },
  {
    key: 'showAbsorption',
    name: 'Shark Limit Walls & Absorption Detector (LIMIT/ABS)',
    shortCode: 'LIMIT/ABS',
    category: 'liquidity',
    zone: 'Chart Overlay',
    zoneDesc: 'Đánh dấu các vị trí tường lệnh chờ cá mập hấp thụ lệnh thị trường',
    badge: 'Order Flow',
    formula: 'L2 Resting Orders + Aggressive Market Volume Absorption',
    description:
      'Hiển thị các bức tường lệnh chờ Limit lớn và phát hiện sự kiện hấp thụ (khối lượng thị trường khổng lồ bị chặn đứng không thể đẩy giá đi tiếp).',
  },
  {
    key: 'showOptions',
    name: 'Options Strikes & Gamma Exposure (GEX / Walls)',
    shortCode: 'STRIKES',
    category: 'liquidity',
    zone: 'Chart Overlay',
    zoneDesc: 'Các mốc quyền chọn thực tế: Call Wall, Put Wall, Zero Gamma Flip',
    badge: 'Deribit',
    formula: 'GEX = S × Γ × OI × 100 | Call Wall, Put Wall, Zero Gamma Flip',
    description:
      'Các mốc thực tế từ thị trường quyền chọn Deribit: Call Wall, Put Wall, Zero Gamma Flip. Giúp dự báo biên độ dao động và điểm nén giá của Market Maker hedging.',
  },
  {
    key: 'showBubbles',
    name: 'Large Trade Volume Bubbles',
    shortCode: 'BUBBLES',
    category: 'liquidity',
    zone: 'Chart Overlay',
    zoneDesc: 'Bong bóng tròn tại vị trí khớp các lệnh lớn (Whale trades)',
    badge: 'Block Trades',
    formula: 'Radius ∝ √TradeQuantity where Vol ≥ Threshold',
    description:
      'Vẽ các vòng tròn bong bóng tại tọa độ chính xác của các lệnh khớp thị trường cỡ lớn (Whale trades), dễ dàng nhận diện dấu chân dòng tiền thông minh.',
  },
  {
    key: 'showHeatmap',
    name: 'Resting L2 Liquidity Heatmap',
    shortCode: 'HEATMAP',
    category: 'liquidity',
    zone: 'Chart Overlay',
    zoneDesc: 'Bản đồ nhiệt độ lịch sử sổ lệnh L2 chạy theo thời gian',
    badge: 'Depth History',
    formula: 'Time-series color mapping of resting Bid/Ask sizes',
    description:
      'Bản đồ nhiệt độ lịch sử độ sâu sổ lệnh L2, cho thấy các lệnh đặt chờ đang nằm ở đâu, khi nào bị rút lệnh (Spoofing) hoặc khi nào được bồi thêm thanh khoản.',
  },

  // ─── 5. MBO BUNDLE (Market-By-Order L3) ───
  {
    key: 'showIcebergs',
    name: 'MBO Iceberg Tracker (Lệnh nạp ẩn tổ chức)',
    shortCode: 'MBO-ICE',
    category: 'mbo',
    zone: 'Chart Overlay',
    zoneDesc: 'Huy hiệu khối băng nổi đánh dấu mức giá có lệnh nạp ẩn',
    badge: 'CME MBO',
    formula: 'TotalExec > InitialDisplayed * 1.5 & RefillCount >= 1',
    description:
      'Nhận diện các lệnh ẩn Iceberg lớn của tổ chức liên tục tái nạp (Replenishment) thanh khoản tại 1 mức giá cố định mà không cho giá trượt qua.',
  },
  {
    key: 'showStopRuns',
    name: 'MBO Stop Runs Tracker (Bẫy quét dừng lỗ)',
    shortCode: 'STOP-RUNS',
    category: 'mbo',
    zone: 'Chart Overlay',
    zoneDesc: 'Tia cảnh báo tại các vùng quét thanh khoản dừng lỗ cực hạn',
    badge: 'Liquidity Run',
    formula: 'Tick Volume Acceleration > 3σ at Swing Extremes',
    description:
      'Phát hiện chuỗi kích hoạt lệnh Stop Loss dồn dập (Stop Cascades) tại các đỉnh/đáy then chốt, nhận diện thời điểm cá mập săn thanh khoản rồi đảo chiều.',
  },
  {
    key: 'showSweeps',
    name: 'MBO Sweeps Tracker (Lệnh càn quét đa tầng)',
    shortCode: 'SWEEPS',
    category: 'mbo',
    zone: 'Chart Overlay',
    zoneDesc: 'Mũi tên xung lực quét sạch các mức giá liên tiếp',
    badge: 'Aggressive Sweep',
    formula: 'Single Market Order sweeping >= 3 price levels in < 1ms',
    description:
      'Đánh dấu các lệnh thị trường càn quét liên tiếp nhiều bước giá (Intermarket Sweeps), biểu hiện xung lực mua/bán áp đảo của các thuật toán HFT.',
  },

  // ─── 6. OPTIONS CHAIN & SUITE ───
  {
    key: 'showOptions',
    name: 'Options Key Levels (Call/Put Walls & Max Pain)',
    shortCode: 'OPT-WALLS',
    category: 'options',
    zone: 'Chart Overlay',
    zoneDesc: 'Đường ngang đánh dấu Call Wall, Put Wall, Zero Gamma Flip',
    badge: 'Deribit Live',
    formula: 'Call Wall = Max(Call OI) | Put Wall = Max(Put OI) | Max Pain',
    description:
      'Các mốc thực tế từ thị trường quyền chọn Deribit: Call Wall, Put Wall, Zero Gamma Flip. Giúp dự báo biên độ dao động và điểm nén giá của Market Maker hedging.',
  },
  {
    key: 'showOptionsExpectedMove',
    name: 'Options Chain: Expected Move (Dải biến độ kỳ vọng)',
    shortCode: 'OPT-EXP',
    category: 'options',
    zone: 'Chart Overlay',
    zoneDesc: 'Dải hình nón hoặc tia ngang biên độ biến động kỳ vọng',
    badge: 'Expected Move',
    formula: 'Expected Move = Spot × 0.85 × ATM_IV × √(DTE / 365)',
    description:
      'Biên độ dao động giá dự kiến theo biến động hàm ý (Implied Volatility) từ hợp đồng quyền chọn ATM straddle cho kỳ đáo hạn gần nhất.',
  },
  {
    key: 'showRiskManager',
    name: 'Risk Manager Monitor (Giám sát rủi ro tài khoản)',
    shortCode: 'RISK-MGR',
    category: 'sub_panels',
    zone: 'Sub-Panel',
    zoneDesc: 'Cửa sổ giám sát giới hạn lỗ và khóa lệnh vi phạm',
    badge: 'ATAS Risk',
    formula: 'Daily Loss Limit, Max Lot, Trailing Max Drawdown',
    description:
      'Theo dõi và tự động khóa lệnh khi chạm giới hạn lỗ tối đa trong ngày (Daily Max Loss) và kiểm soát rủi ro tài khoản định chế.',
  },
];

export const IndicatorsModal: React.FC<IndicatorsModalProps> = ({
  isOpen,
  onClose,
  config,
  onChangeConfig,
  onApplyPreset,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'sub_panels' | 'clusters' | 'structure' | 'liquidity' | 'mbo' | 'options'>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedKey, setSelectedKey] = useState<keyof IndicatorConfigState>('showVolHistogram');

  if (!isOpen) return null;

  const filteredItems = INDICATOR_CATALOG.filter((item) => {
    const matchesTab = activeTab === 'all' || item.category === activeTab;
    const matchesSearch =
      searchTerm.trim() === '' ||
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.shortCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.description.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesTab && matchesSearch;
  });

  const selectedItem = INDICATOR_CATALOG.find((i) => i.key === selectedKey) || INDICATOR_CATALOG[0];
  const isSelectedEnabled = Boolean(config[selectedItem.key]);
  const activeCount = INDICATOR_CATALOG.filter((i) => Boolean(config[i.key])).length;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(5, 7, 12, 0.85)',
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
          width: '840px',
          maxWidth: '96vw',
          height: '560px',
          maxHeight: '92vh',
          background: '#11141C',
          border: '1px solid #282F3F',
          borderRadius: '6px',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ===================================================================
            HEADER: Desktop Application Style (ATAS / NinjaTrader Standard)
            =================================================================== */}
        <div
          style={{
            height: '38px',
            minHeight: '38px',
            background: '#161A24',
            borderBottom: '1px solid #232836',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 800, color: '#F8FAFC', letterSpacing: '0.4px' }}>
              CHỈ BÁO BIỂU ĐỒ (INDICATORS)
            </span>
            <span
              style={{
                fontSize: '9.5px',
                color: '#64748B',
                background: '#1D2230',
                padding: '1px 6px',
                borderRadius: '3px',
                fontWeight: 700,
              }}
            >
              Ctrl + I
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '11px', color: '#94A3B8' }}>
              Đang bật: <strong style={{ color: '#089981' }}>{activeCount}</strong> / {INDICATOR_CATALOG.length}
            </span>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94A3B8',
                fontSize: '14px',
                cursor: 'pointer',
                padding: '2px 6px',
              }}
              title="Đóng (Esc)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* ===================================================================
            BODY: 2-COLUMN SPLIT (Left: Indicator List | Right: Properties)
            =================================================================== */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* ─── LEFT COLUMN: Indicator Directory (330px) ─── */}
          <div
            style={{
              width: '330px',
              minWidth: '310px',
              borderRight: '1px solid #232836',
              background: '#0E1118',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Search Box */}
            <div style={{ padding: '8px 10px', borderBottom: '1px solid #1E2330' }}>
              <input
                type="text"
                placeholder="Tìm kiếm chỉ báo..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  width: '100%',
                  background: '#161922',
                  border: '1px solid #262D3D',
                  borderRadius: '3px',
                  padding: '4px 8px',
                  color: '#F8FAFC',
                  fontSize: '11px',
                  outline: 'none',
                }}
              />
            </div>

            {/* Category Filter Tabs */}
            <div
              style={{
                display: 'flex',
                gap: '2px',
                padding: '4px 8px',
                borderBottom: '1px solid #1E2330',
                background: '#12151D',
                overflowX: 'auto',
              }}
            >
              {[
                { id: 'all', label: 'Tất cả' },
                { id: 'sub_panels', label: 'Sub-Panels' },
                { id: 'clusters', label: 'Footprint' },
                { id: 'structure', label: 'Cấu trúc' },
                { id: 'liquidity', label: 'Thanh khoản' },
                { id: 'mbo', label: 'MBO Bundle' },
                { id: 'options', label: 'Options Suite' },
              ].map((tab) => {
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    style={{
                      background: active ? '#222838' : 'transparent',
                      color: active ? '#38BDF8' : '#78889B',
                      border: 'none',
                      borderRadius: '3px',
                      padding: '3px 6px',
                      fontSize: '10px',
                      fontWeight: active ? 700 : 500,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* List Table */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredItems.map((item) => {
                const isEnabled = Boolean(config[item.key]);
                const isSelected = selectedKey === item.key;
                const isSubPanel = item.zone === 'Sub-Panel';

                return (
                  <div
                    key={item.key}
                    onClick={() => setSelectedKey(item.key)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '6px 10px',
                      gap: '8px',
                      borderBottom: '1px solid rgba(35, 40, 54, 0.4)',
                      background: isSelected ? '#1B2232' : 'transparent',
                      borderLeft: isSelected ? '3px solid #089981' : '3px solid transparent',
                      cursor: 'pointer',
                    }}
                  >
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={(e) => {
                        e.stopPropagation();
                        onChangeConfig({ [item.key]: e.target.checked });
                      }}
                      style={{ cursor: 'pointer', margin: 0 }}
                    />

                    {/* Short Code */}
                    <span
                      style={{
                        fontSize: '9px',
                        fontWeight: 800,
                        fontFamily: '"JetBrains Mono", monospace',
                        color: isEnabled ? '#089981' : '#64748B',
                        width: '48px',
                        flexShrink: 0,
                      }}
                    >
                      {item.shortCode}
                    </span>

                    {/* Indicator Name */}
                    <span
                      style={{
                        fontSize: '11px',
                        color: isSelected ? '#FFFFFF' : isEnabled ? '#CBD5E1' : '#7E8B9F',
                        fontWeight: isSelected || isEnabled ? 600 : 400,
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.name}
                    </span>

                    {/* Zone Badge */}
                    <span
                      style={{
                        fontSize: '8.5px',
                        fontWeight: 700,
                        color: isSubPanel ? '#F59E0B' : '#64748B',
                        background: isSubPanel ? 'rgba(245, 158, 11, 0.12)' : 'rgba(100, 116, 139, 0.12)',
                        padding: '1px 4px',
                        borderRadius: '2px',
                        flexShrink: 0,
                      }}
                    >
                      {isSubPanel ? 'Sub' : 'Chart'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ─── RIGHT COLUMN: Indicator Properties & Control (~510px) ─── */}
          <div
            style={{
              flex: 1,
              background: '#12151D',
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
              gap: '14px',
            }}
          >
            {/* Header: Name + Toggle Button */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', borderBottom: '1px solid #1E2330', paddingBottom: '12px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      background: '#1E2536',
                      color: '#38BDF8',
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: '10px',
                      fontWeight: 800,
                      padding: '2px 6px',
                      borderRadius: '3px',
                    }}
                  >
                    {selectedItem.shortCode}
                  </span>
                  <span style={{ fontSize: '14px', fontWeight: 800, color: '#F8FAFC' }}>
                    {selectedItem.name}
                  </span>
                </div>
                <div style={{ fontSize: '10.5px', color: '#7E8B9F', marginTop: '3px' }}>
                  Phân loại: <strong style={{ color: '#CBD5E1' }}>{selectedItem.badge}</strong> · Khu vực: <strong style={{ color: selectedItem.zone === 'Sub-Panel' ? '#F59E0B' : '#38BDF8' }}>{selectedItem.zone}</strong>
                </div>
              </div>

              {/* Instant Toggle Button */}
              <button
                onClick={() => onChangeConfig({ [selectedItem.key]: !isSelectedEnabled })}
                style={{
                  background: isSelectedEnabled ? 'rgba(8, 153, 129, 0.18)' : '#1E2330',
                  color: isSelectedEnabled ? '#089981' : '#94A3B8',
                  border: isSelectedEnabled ? '1px solid #089981' : '1px solid #2E384D',
                  padding: '5px 12px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  flexShrink: 0,
                }}
              >
                <span>{isSelectedEnabled ? '✓ ĐANG BẬT' : '○ ĐANG TẮT'}</span>
              </button>
            </div>

            {/* Zone Placement Specification */}
            <div style={{ background: '#161922', border: '1px solid #232836', borderRadius: '4px', padding: '10px 12px' }}>
              <div style={{ fontSize: '10px', fontWeight: 800, color: '#7E8B9F', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '4px' }}>
                Vị Trí Phân Vùng Biểu Đồ (Panel Placement)
              </div>
              <div style={{ fontSize: '11px', color: '#E2E8F0', lineHeight: 1.4 }}>
                {selectedItem.zoneDesc}
              </div>
            </div>

            {/* Description & Institutional Use Case */}
            <div style={{ background: '#161922', border: '1px solid #232836', borderRadius: '4px', padding: '10px 12px' }}>
              <div style={{ fontSize: '10px', fontWeight: 800, color: '#7E8B9F', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '4px' }}>
                Ý Nghĩa Định Lượng & Ứng Dụng Thực Chiến
              </div>
              <div style={{ fontSize: '11px', color: '#CBD5E1', lineHeight: 1.5 }}>
                {selectedItem.description}
              </div>
            </div>

            {/* Math Formula / Calculation Principle */}
            <div style={{ background: '#161922', border: '1px solid #232836', borderRadius: '4px', padding: '10px 12px' }}>
              <div style={{ fontSize: '10px', fontWeight: 800, color: '#7E8B9F', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '4px' }}>
                Nguyên Lý Tính Toán
              </div>
              <div
                style={{
                  fontSize: '10.5px',
                  fontFamily: '"JetBrains Mono", monospace',
                  color: '#38BDF8',
                  background: '#0F1218',
                  padding: '6px 8px',
                  borderRadius: '3px',
                  border: '1px solid #1E2330',
                  marginTop: '4px',
                }}
              >
                {selectedItem.formula}
              </div>
            </div>
          </div>
        </div>

        {/* ===================================================================
            FOOTER: Quick Presets & Close
            =================================================================== */}
        <div
          style={{
            height: '42px',
            minHeight: '42px',
            background: '#161A24',
            borderTop: '1px solid #232836',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 14px',
          }}
        >
          {/* Quick Presets */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '10.5px', color: '#7E8B9F', fontWeight: 700 }}>Mẫu nhanh:</span>
            {[
              { id: 'atas_standard', label: 'ATAS Mặc Định' },
              { id: 'scalper_flow', label: 'Scalper Flow' },
              { id: 'macro_institutional', label: 'Macro Levels' },
              { id: 'clean_price', label: 'Clean Price' },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => onApplyPreset(p.id as any)}
                style={{
                  background: '#1D2230',
                  border: '1px solid #283042',
                  color: '#CBD5E1',
                  padding: '3px 8px',
                  borderRadius: '3px',
                  fontSize: '10.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              onClick={onClose}
              style={{
                background: '#089981',
                border: 'none',
                color: '#FFFFFF',
                padding: '4px 14px',
                borderRadius: '3px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Đóng (Esc)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
