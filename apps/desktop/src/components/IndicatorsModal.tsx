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

  // Liquidity & Options
  showSlClusters: boolean;
  showAbsorption: boolean;
  showOptions: boolean;
  showBubbles: boolean;
  showHeatmap: boolean;
  showChartDom: boolean;
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
  category: 'sub_panels' | 'clusters' | 'structure' | 'liquidity';
  zone: 'Cửa Sổ Phụ (Sub-Panel)' | 'Lớp Phủ Biểu Đồ (Main Chart)';
  badge: string;
  badgeColor: string;
  formula: string;
  description: string;
}

const INDICATOR_CATALOG: IndicatorItemDef[] = [
  // ─── 1. SUB-PANELS ───
  {
    key: 'showVolHistogram',
    name: 'Volume Histogram (Khối Lượng Phiên)',
    shortCode: 'VOL',
    category: 'sub_panels',
    zone: 'Cửa Sổ Phụ (Sub-Panel)',
    badge: 'ATAS Core',
    badgeColor: '#00E676',
    formula: 'V_bar = Σ (Vol_buy + Vol_sell)',
    description:
      'Biểu đồ cột thể hiện tổng khối lượng giao dịch thực tế của từng nến, phân màu theo Delta mua/bán với trục tỷ lệ độc lập bên phải.',
  },
  {
    key: 'showCvdPanel',
    name: 'Cumulative Volume Delta (CVD Tích Lũy)',
    shortCode: 'CVD',
    category: 'sub_panels',
    zone: 'Cửa Sổ Phụ (Sub-Panel)',
    badge: 'ATAS Core',
    badgeColor: '#00E5FF',
    formula: 'CVD_t = CVD_{t-1} + (Vol_ask - Vol_bid)',
    description:
      'Đường cong delta tích lũy liên tục qua các phiên giao dịch. Dùng để phát hiện phân kỳ đỉnh/đáy (Absorption và Exhaustion) khi giá tạo đỉnh mới nhưng CVD không tăng tương ứng.',
  },
  {
    key: 'showCotGrid',
    name: 'COT Tape Matrix (Lưới Nhiệt Delta 4 Hàng)',
    shortCode: 'COT/Δ',
    category: 'sub_panels',
    zone: 'Cửa Sổ Phụ (Sub-Panel)',
    badge: 'DeepChart Signature',
    badgeColor: '#F59E0B',
    formula: 'Rows: [COT Bar, Δ Qty, Δ %, Δ Vol]',
    description:
      'Bảng ma trận 4 hàng hiển thị dòng lệnh chi tiết dưới chân biểu đồ với màu nhiệt tương phản cao (High Contrast 10:1), đọc vị xung lực mua/bán ngay lập tức.',
  },

  // ─── 2. FOOTPRINT CLUSTERS ───
  {
    key: 'showOfBa',
    name: 'Footprint Bid × Ask Numbers & POC Box',
    shortCode: 'OF-B/A',
    category: 'clusters',
    zone: 'Lớp Phủ Biểu Đồ (Main Chart)',
    badge: 'Order Flow',
    badgeColor: '#00E676',
    formula: 'Cell = Bid (Market Sells) × Ask (Market Buys)',
    description:
      'Hiển thị con số dòng lệnh khớp vi mô theo từng mức giá kèm khung hộp vàng bao bọc mức giá tích lũy khối lượng lớn nhất (Point of Control - POC).',
  },
  {
    key: 'showOfVp',
    name: 'Footprint Cluster Volume Profile Bars',
    shortCode: 'OF-VP',
    category: 'clusters',
    zone: 'Lớp Phủ Biểu Đồ (Main Chart)',
    badge: 'Order Flow',
    badgeColor: '#38BDF8',
    formula: 'BarWidth ∝ (Vol_level / MaxVol_bar)',
    description:
      'Dải thanh ngang phân phối khối lượng ngay trong lòng mỗi nến, giúp nhận diện sự dồn nén thanh khoản và sự chấp thuận giá của thị trường.',
  },
  {
    key: 'showOfDeltaP',
    name: 'Footprint Bi-Directional Delta Profile',
    shortCode: 'OF-ΔP',
    category: 'clusters',
    zone: 'Lớp Phủ Biểu Đồ (Main Chart)',
    badge: 'Order Flow',
    badgeColor: '#C084FC',
    formula: 'Δ_level = Ask_level - Bid_level',
    description:
      'Dải profile lưỡng hướng tách biệt phe Mua chủ động (xanh lá sang phải) và phe Bán chủ động (đỏ/tím sang trái) trên từng mức giá.',
  },
  {
    key: 'showBarHeadStats',
    name: 'Bar Head Summary Stats (Delta & Vol Đỉnh Nến)',
    shortCode: 'HEAD Δ/V',
    category: 'clusters',
    zone: 'Lớp Phủ Biểu Đồ (Main Chart)',
    badge: 'Visual Aid',
    badgeColor: '#94A3B8',
    formula: 'Top: Delta | Bottom: Total Volume',
    description:
      'Nhãn thông số tóm tắt Delta và Tổng khối lượng đặt ngay phía trên râu nến cao nhất, giúp đọc nhanh giá trị mà không cần nhìn xuống cửa sổ phụ.',
  },

  // ─── 3. STRUCTURE & HTF LEVELS ───
  {
    key: 'showPriorDayLevels',
    name: 'HTF Prior Day Reference Levels (PDH, PDL, PDPOC, PDVAH, PDVAL)',
    shortCode: 'HTF-PD',
    category: 'structure',
    zone: 'Lớp Phủ Biểu Đồ (Main Chart)',
    badge: 'Institutional HTF',
    badgeColor: '#F43F5E',
    formula: 'Group UTC Day: PDH, PDL, PDPOC, 70% Value Area [PDVAH, PDVAL]',
    description:
      'Tự động tính toán và phóng chiếu ngang 5 mốc then chốt của phiên ngày hôm qua. Đây là các điểm phản ứng thanh khoản bắt buộc của các quỹ định lượng và trader tổ chức.',
  },
  {
    key: 'showVolumeProfile',
    name: 'Session Volume Profile 24h (D-VP)',
    shortCode: 'D-VP',
    category: 'structure',
    zone: 'Lớp Phủ Biểu Đồ (Main Chart)',
    badge: 'Auction Market',
    badgeColor: '#1E88E5',
    formula: 'P_Session = Σ V(Price) over True 24h Day',
    description:
      'Hồ sơ khối lượng phiên giao dịch chuẩn 24 giờ neo cố định bên mép phải biểu đồ. Không bị nhảy lung tung khi bạn cuộn chuột qua lại.',
  },
  {
    key: 'showValueAreaLines',
    name: 'Session Value Area Lines (dVAH, dVAL, dPOC)',
    shortCode: 'D-VL',
    category: 'structure',
    zone: 'Lớp Phủ Biểu Đồ (Main Chart)',
    badge: 'Auction Market',
    badgeColor: '#FACC15',
    formula: 'Value Area = 70% Total Session Volume centered at POC',
    description:
      'Các đường tham chiếu vùng giá trị phiên (Value Area High, Value Area Low, Point of Control). Giá thường dao động kiểm định các mốc này trong 70-80% thời gian.',
  },
  {
    key: 'showVwap',
    name: 'Developing Session VWAP & StDev Bands',
    shortCode: 'VWAP',
    category: 'structure',
    zone: 'Lớp Phủ Biểu Đồ (Main Chart)',
    badge: 'Benchmark',
    badgeColor: '#A855F7',
    formula: 'VWAP = Σ(Price × Volume) / Σ(Volume)',
    description:
      'Đường trung bình giá gia quyền khối lượng đang phát triển của phiên giao dịch. Chuẩn mực định giá công bằng của các thuật toán TWAP/VWAP tổ chức.',
  },
  {
    key: 'showNakedPoc',
    name: 'Naked Unmitigated POC Rays (NPOC)',
    shortCode: 'NPOC',
    category: 'structure',
    zone: 'Lớp Phủ Biểu Đồ (Main Chart)',
    badge: 'Price Magnet',
    badgeColor: '#EAB308',
    formula: 'POC_{bar} where Price_{subsequent} never traded through',
    description:
      'Các tia vàng nét đứt kéo dài từ các đỉnh POC trong quá khứ chưa từng bị giá quay lại chạm vào. Hoạt động như thỏi nam châm hút thanh khoản cực mạnh.',
  },
  {
    key: 'showStackedImbalances',
    name: 'Stacked Imbalance Zones (Vùng Mất Cân Bằng Chồng Tầng)',
    shortCode: 'STK-IMB',
    category: 'structure',
    zone: 'Lớp Phủ Biểu Đồ (Main Chart)',
    badge: 'Institutional Zone',
    badgeColor: '#22C55E',
    formula: '≥ 3 consecutive levels with diagonal Ask/Bid ratio ≥ 300%',
    description:
      'Vùng cung/cầu tổ chức xuất hiện khi có từ 3 mức giá liên tiếp mất cân bằng mua hoặc bán chéo từ 300% trở lên. Vùng này được kéo dài vào tương lai cho tới khi giá quay lại test.',
  },

  // ─── 4. LIQUIDITY & OPTIONS ───
  {
    key: 'showSlClusters',
    name: 'Stop-Loss Clusters & Liquidity Pools (SL/LIQ)',
    shortCode: 'SL/LIQ',
    category: 'liquidity',
    zone: 'Lớp Phủ Biểu Đồ (Main Chart)',
    badge: 'Liquidity Hunter',
    badgeColor: '#EC4899',
    formula: 'Est. Pools at Swing Highs (BSL) & Swing Lows (SSL) + 50x-100x Liq',
    description:
      'Bản đồ dự đoán các cụm cắt lỗ của đám đông và các vùng thanh lý đòn bẩy cao. Nơi cá mập thường xuyên quét râu qua để gom hàng trước khi đảo chiều.',
  },
  {
    key: 'showAbsorption',
    name: 'Shark Limit Walls & Absorption Detector (LIMIT/ABS)',
    shortCode: 'LIMIT/ABS',
    category: 'liquidity',
    zone: 'Lớp Phủ Biểu Đồ (Main Chart)',
    badge: 'Market Depth',
    badgeColor: '#06B6D4',
    formula: 'L2 Top Resting Orders + Aggressive Market Volume Absorption',
    description:
      'Hiển thị các bức tường lệnh chờ Limit lớn của cá mập trên sổ lệnh L2 và phát hiện sự kiện hấp thụ (khối lượng thị trường khổng lồ bị chặn đứng không thể đẩy giá đi tiếp).',
  },
  {
    key: 'showOptions',
    name: 'Options Strikes & Gamma Exposure (GEX / Walls)',
    shortCode: 'STRIKES',
    category: 'liquidity',
    zone: 'Lớp Phủ Biểu Đồ (Main Chart)',
    badge: 'Deribit Direct',
    badgeColor: '#8B5CF6',
    formula: 'GEX = S × Γ × OI × 100 | Call Wall, Put Wall, Zero Gamma Flip',
    description:
      'Các mốc thực tế từ thị trường quyền chọn Deribit: Call Wall, Put Wall, Zero Gamma Flip. Giúp dự báo biên độ dao động và điểm nén giá của Market Maker hedging.',
  },
  {
    key: 'showBubbles',
    name: 'Large Trade Volume Bubbles',
    shortCode: 'BUBBLES',
    category: 'liquidity',
    zone: 'Lớp Phủ Biểu Đồ (Main Chart)',
    badge: 'Block Trades',
    badgeColor: '#10B981',
    formula: 'Radius ∝ √TradeQuantity where Vol ≥ Threshold',
    description:
      'Vẽ các vòng tròn bong bóng tại tọa độ chính xác của các lệnh khớp thị trường cỡ lớn (Whale trades), dễ dàng nhận diện dấu chân dòng tiền thông minh.',
  },
  {
    key: 'showHeatmap',
    name: 'Resting L2 Liquidity Heatmap',
    shortCode: 'HEATMAP',
    category: 'liquidity',
    zone: 'Lớp Phủ Biểu Đồ (Main Chart)',
    badge: 'Depth History',
    badgeColor: '#F97316',
    formula: 'Time-series color mapping of resting Bid/Ask sizes',
    description:
      'Bản đồ nhiệt độ lịch sử độ sâu sổ lệnh L2, cho thấy các lệnh đặt chờ đang nằm ở đâu, khi nào bị rút lệnh (Spoofing) hoặc khi nào được bồi thêm thanh khoản.',
  },
  {
    key: 'showChartDom',
    name: 'In-Chart DOM Trading Strip (Cột L2 Kế Trục Giá)',
    shortCode: 'DOM Trading',
    category: 'liquidity',
    zone: 'Lớp Phủ Biểu Đồ (Main Chart)',
    badge: 'Execution',
    badgeColor: '#14B8A6',
    formula: 'Real-time Bids (Green) & Asks (Red) size bars aligned to Price Y',
    description:
      'Cột hiển thị thanh khoản sổ lệnh cấp 2 đặt ngay liền kề trục giá bên phải biểu đồ kèm nút Cancel All / Flat All, hỗ trợ thao tác đặt lệnh khớp 1-click trực quan như ATAS.',
  },
];

export const IndicatorsModal: React.FC<IndicatorsModalProps> = ({
  isOpen,
  onClose,
  config,
  onChangeConfig,
  onApplyPreset,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'sub_panels' | 'clusters' | 'structure' | 'liquidity'>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');

  if (!isOpen) return null;

  const filteredItems = INDICATOR_CATALOG.filter((item) => {
    const matchesTab = activeTab === 'all' || item.category === activeTab;
    const matchesSearch =
      searchTerm.trim() === '' ||
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.shortCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.badge.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesTab && matchesSearch;
  });

  const activeCount = INDICATOR_CATALOG.filter((i) => Boolean(config[i.key])).length;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(5, 7, 12, 0.82)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: '16px',
        userSelect: 'none',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '880px',
          maxWidth: '96vw',
          height: '720px',
          maxHeight: '92vh',
          background: '#0F1219',
          border: '1px solid #282F3F',
          borderRadius: '10px',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.75), 0 0 1px 1px rgba(255, 255, 255, 0.08)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #222836',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#141822',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#F8FAFC', letterSpacing: '0.3px' }}>
                THƯ VIỆN CHỈ BÁO ĐỊNH LƯỢNG & ORDER FLOW (INDICATORS)
              </div>
              <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '2px' }}>
                Chuẩn mực ATAS & DeepChart Pro · Phân định rõ ràng vùng biểu đồ chính & cửa sổ phụ (Sub-Panels)
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: '#00E676',
                background: 'rgba(0, 230, 118, 0.12)',
                padding: '3px 9px',
                borderRadius: '4px',
                border: '1px solid rgba(0, 230, 118, 0.3)',
              }}
            >
              Đang bật: {activeCount}/{INDICATOR_CATALOG.length}
            </span>
            <button
              onClick={onClose}
              style={{
                background: '#1F2432',
                border: '1px solid #323A4D',
                color: '#CBD5E1',
                width: '28px',
                height: '28px',
                borderRadius: '6px',
                fontSize: '14px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Đóng (Esc)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Quick Presets Bar */}
        <div
          style={{
            padding: '10px 20px',
            borderBottom: '1px solid #1E2330',
            background: '#11141D',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#7E8B9F', marginRight: '4px' }}>
            MẪU CẤU HÌNH NHANH:
          </span>
          {[
            { id: 'atas_standard', label: 'ATAS Classic (Mặc Định)', tip: 'Footprint B/A + Session 24h + Volume + CVD' },
            { id: 'scalper_flow', label: 'Order Flow Scalper', tip: 'Delta Profile + Stacked Imbalances + Absorption + DOM' },
            { id: 'macro_institutional', label: 'Macro Institutional', tip: 'HTF-PD + 24h Profile + VWAP + COT Matrix + Liquidity' },
            { id: 'clean_price', label: 'Clean Price Action', tip: 'Tắt toàn bộ chỉ báo phụ, chỉ giữ nến & Profile' },
          ].map((preset) => (
            <button
              key={preset.id}
              onClick={() => onApplyPreset(preset.id as any)}
              style={{
                background: '#1B202C',
                border: '1px solid #2B3346',
                color: '#E2E8F0',
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              title={preset.tip}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Search & Category Filter Navigation */}
        <div
          style={{
            padding: '10px 20px',
            borderBottom: '1px solid #1E2330',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '4px' }}>
            {[
              { id: 'all', label: `Tất cả (${INDICATOR_CATALOG.length})` },
              { id: 'sub_panels', label: 'Cửa Sổ Phụ (Sub-Panels)' },
              { id: 'clusters', label: 'Cụm Footprint' },
              { id: 'structure', label: 'Cấu Trúc & Khung Lớn' },
              { id: 'liquidity', label: 'Thanh Khoản & Options' },
            ].map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  style={{
                    background: active ? '#2A3346' : 'transparent',
                    color: active ? '#00E676' : '#94A3B8',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '5px 10px',
                    fontSize: '11.5px',
                    fontWeight: active ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Search Box */}
          <div style={{ position: 'relative', width: '220px' }}>
            <input
              type="text"
              placeholder="Tìm kiếm chỉ báo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                background: '#171B24',
                border: '1px solid #2B3346',
                borderRadius: '4px',
                padding: '5px 10px 5px 24px',
                color: '#F8FAFC',
                fontSize: '11.5px',
                outline: 'none',
              }}
            />
            <span
              style={{
                position: 'absolute',
                left: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#64748B',
                fontSize: '11px',
              }}
            >
              ⌕
            </span>
          </div>
        </div>

        {/* Indicators List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filteredItems.map((item) => {
            const isEnabled = Boolean(config[item.key]);
            const isSubPanel = item.zone.includes('Sub-Panel');

            return (
              <div
                key={item.key}
                style={{
                  background: isEnabled ? '#151A25' : '#11141B',
                  border: isEnabled ? '1px solid #2D3A52' : '1px solid #1E2330',
                  borderRadius: '6px',
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '16px',
                  transition: 'background 0.15s ease',
                }}
              >
                {/* Left Meta & Details */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 800,
                        background: '#1F2432',
                        color: '#38BDF8',
                        padding: '1px 6px',
                        borderRadius: '3px',
                        fontFamily: '"JetBrains Mono", monospace',
                      }}
                    >
                      {item.shortCode}
                    </span>

                    <span style={{ fontSize: '13px', fontWeight: 700, color: isEnabled ? '#FFFFFF' : '#CBD5E1' }}>
                      {item.name}
                    </span>

                    <span
                      style={{
                        fontSize: '9.5px',
                        fontWeight: 700,
                        color: item.badgeColor,
                        background: `${item.badgeColor}18`,
                        border: `1px solid ${item.badgeColor}40`,
                        padding: '1px 5px',
                        borderRadius: '3px',
                      }}
                    >
                      {item.badge}
                    </span>

                    <span
                      style={{
                        fontSize: '9.5px',
                        fontWeight: 600,
                        color: isSubPanel ? '#F59E0B' : '#94A3B8',
                        background: isSubPanel ? 'rgba(245, 158, 11, 0.12)' : 'rgba(148, 163, 184, 0.12)',
                        padding: '1px 5px',
                        borderRadius: '3px',
                      }}
                    >
                      {item.zone}
                    </span>
                  </div>

                  <div style={{ fontSize: '11px', color: '#94A3B8', lineHeight: 1.45, marginBottom: '4px' }}>
                    {item.description}
                  </div>

                  <div
                    style={{
                      fontSize: '10px',
                      color: '#64748B',
                      fontFamily: '"JetBrains Mono", monospace',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <span>Công thức định lượng:</span>
                    <code style={{ color: '#A5B4FC', background: '#1A1E29', padding: '1px 4px', borderRadius: '2px' }}>
                      {item.formula}
                    </code>
                  </div>
                </div>

                {/* Right Toggle Switch */}
                <div style={{ flexShrink: 0 }}>
                  <button
                    onClick={() => onChangeConfig({ [item.key]: !isEnabled })}
                    style={{
                      width: '52px',
                      height: '26px',
                      borderRadius: '13px',
                      background: isEnabled ? '#00E676' : '#2A303F',
                      border: 'none',
                      cursor: 'pointer',
                      position: 'relative',
                      transition: 'background 0.2s ease',
                      padding: 0,
                    }}
                    title={isEnabled ? 'Bấm để Tắt' : 'Bấm để Bật'}
                  >
                    <div
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        background: isEnabled ? '#07090E' : '#94A3B8',
                        position: 'absolute',
                        top: '3px',
                        left: isEnabled ? '29px' : '3px',
                        transition: 'left 0.2s ease',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                      }}
                    />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #222836',
            background: '#141822',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: '11px', color: '#64748B' }}>
            Nhấn phím tắt <strong style={{ color: '#E2E8F0' }}>Ctrl + I</strong> trên biểu đồ để mở nhanh bảng chỉ báo bất kỳ lúc nào.
          </div>

          <button
            onClick={onClose}
            style={{
              background: '#00E676',
              color: '#07090E',
              border: 'none',
              borderRadius: '5px',
              padding: '6px 18px',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0, 230, 118, 0.25)',
            }}
          >
            Đóng & Áp Dụng (Esc)
          </button>
        </div>
      </div>
    </div>
  );
};
