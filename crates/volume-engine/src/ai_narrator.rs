//! DeepChart AI Market Structure Explainability Engine (P3.1)
//! Analyzes footprint matrices, stacked imbalances, order flow absorptions,
//! delta divergences, and options key levels to generate structured narrative commentary in Vietnamese.

use crate::indicators::{OrderFlowSignal, OrderFlowSignalType, StackedImbalance};
use crate::volume_profile::SessionVolumeProfile;
use crate::vwap::DeltaDivergence;
use data_contract::{OHLCVBar, OptionsMarketSummary, PriceTicks};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MarketNarrative {
    pub sentiment: String,          // "BULLISH" | "BEARISH" | "NEUTRAL" | "CONSOLIDATION"
    pub headline: String,           // Concise summary headline
    pub order_flow_summary: String, // Footprint & Delta analysis
    pub options_confluence: String, // Wall & Max Pain interactions
    pub institutional_bias: String, // Absorption, exhaustion & whale prints
    pub risk_alert: String,         // Warnings on traps & divergences
}

/// Generates algorithmic market narrative based on multi-indicator order flow convergence.
pub fn generate_market_narrative(
    bars: &[OHLCVBar],
    active_bar: Option<&OHLCVBar>,
    stacked_imbalances: &[StackedImbalance],
    signals: &[OrderFlowSignal],
    divergences: &[DeltaDivergence],
    options: Option<&OptionsMarketSummary>,
    _profile: Option<&SessionVolumeProfile>,
) -> MarketNarrative {
    let mut sentiment = "NEUTRAL".to_string();
    let mut headline = "Thị trường đang tích lũy cân bằng trong biên độ hẹp.".to_string();
    let mut order_flow_summary = "Dòng lệnh hai chiều cân bằng, chưa có phe nào bứt phá rõ rệt.".to_string();
    let mut options_confluence = "Chưa phát hiện vùng hợp lưu quyền chọn gần giá hiện tại.".to_string();
    let mut institutional_bias = "Khối lượng giao dịch phân bổ đều, chưa có dấu hiệu gom/xả đột biến.".to_string();
    let mut risk_alert = "Duy trì quản trị vốn thận trọng khi thị trường chưa thoát khỏi vùng tích lũy.".to_string();

    let last_price_ticks = active_bar
        .map(|b| b.close_ticks)
        .or_else(|| bars.last().map(|b| b.close_ticks))
        .unwrap_or(PriceTicks(0));

    // 1. Analyze Order Flow Signals (Absorption / Exhaustion)
    let has_bullish_absorption = signals.iter().any(|s| matches!(s.signal_type, OrderFlowSignalType::BullishAbsorption));
    let has_bearish_absorption = signals.iter().any(|s| matches!(s.signal_type, OrderFlowSignalType::BearishAbsorption));
    let has_buying_exhaustion = signals.iter().any(|s| matches!(s.signal_type, OrderFlowSignalType::BuyingExhaustion));
    let has_selling_exhaustion = signals.iter().any(|s| matches!(s.signal_type, OrderFlowSignalType::SellingExhaustion));

    // 2. Analyze Stacked Imbalances
    let buy_stacks = stacked_imbalances.iter().filter(|s| s.side == crate::indicators::ImbalanceSide::Buy).count();
    let sell_stacks = stacked_imbalances.iter().filter(|s| s.side == crate::indicators::ImbalanceSide::Sell).count();

    // 3. Analyze Delta Divergences
    let has_bull_div = divergences.iter().any(|d| d.divergence_type == crate::vwap::DivergenceType::BullishDivergence);
    let has_bear_div = divergences.iter().any(|d| d.divergence_type == crate::vwap::DivergenceType::BearishDivergence);

    // Formulate Market Sentiment & Headline
    if has_bullish_absorption || (buy_stacks > sell_stacks && !has_buying_exhaustion) {
        sentiment = "BULLISH".to_string();
        headline = if has_bullish_absorption {
            "🛡 Phe Mua hấp thụ mạnh tại vùng hỗ trợ: Khối lượng bán lớn bị triệt tiêu hoàn toàn!".to_string()
        } else {
            format!("⚡ Phe Mua chiếm ưu thế áp đảo với {} dải Stacked Imbalance liên tiếp!", buy_stacks)
        };
        order_flow_summary = format!(
            "Dòng lệnh chủ động (Aggressor Buy) liên tục nâng giá lên. Xuất hiện {} cụm mất cân bằng mua với tỷ lệ áp đảo >= 300%.",
            buy_stacks
        );
        institutional_bias = "Dấu chân tổ chức: Tích lũy mua chủ động, hấp thụ toàn bộ áp lực chốt lời.".to_string();
    } else if has_bearish_absorption || (sell_stacks > buy_stacks && !has_selling_exhaustion) {
        sentiment = "BEARISH".to_string();
        headline = if has_bearish_absorption {
            "🛡 Phe Bán hấp thụ đỉnh quyết liệt: Lực mua đuổi kiệt sức trước tường thanh khoản ẩn!".to_string()
        } else {
            format!("⚡ Áp lực xả hàng mạnh: Xuất hiện {} dải Stacked Imbalance bán khống chế thị trường!", sell_stacks)
        };
        order_flow_summary = format!(
            "Dòng lệnh bán chủ động (Aggressor Sell) khống chế thị trường, đẩy giá xuyên qua các mốc hỗ trợ với {} cụm mất cân bằng bán.",
            sell_stacks
        );
        institutional_bias = "Dấu chân tổ chức: Dòng tiền lớn bán chặn trên, hấp thụ lực FOMO của nhỏ lẻ.".to_string();
    } else if has_buying_exhaustion {
        sentiment = "CONSOLIDATION".to_string();
        headline = "⚡ Kiệt sức Mua tại đỉnh (Buying Exhaustion): Khối lượng teo tóp khi giá lập đỉnh mới.".to_string();
        risk_alert = "CẢNH BÁO: Rủi ro đảo chiều giảm cao do thiếu lực cầu tiếp ứng (Buyers Trapped).".to_string();
    } else if has_selling_exhaustion {
        sentiment = "CONSOLIDATION".to_string();
        headline = "⚡ Kiệt sức Bán tại đáy (Selling Exhaustion): Lực bán cạn kiệt mở ra cơ hội hồi phục kỹ thuật.".to_string();
        risk_alert = "Cơ hội: Đà bán đã chững lại, chú ý quan sát phản ứng hấp thụ để tìm điểm vào lệnh phe Mua.".to_string();
    }

    // Divergence warning override
    if has_bear_div {
        risk_alert = "⚠️ PHÂN KỲ ÂM (Bearish CVD Divergence): Giá tạo đỉnh cao mới nhưng Cumulative Volume Delta giảm dần. Báo hiệu bẫy tăng giá (Bull Trap)!".to_string();
    } else if has_bull_div {
        risk_alert = "⚠️ PHÂN KỲ DƯƠNG (Bullish CVD Divergence): Giá giảm phá đáy nhưng CVD tăng vọt. Dòng tiền ngầm đang gom hàng mạnh (Bear Trap)!".to_string();
    }

    // 4. Options Confluence Analysis
    if let Some(opt) = options {
        let pcr = opt.put_call_ratio;
        let call_wall = opt.call_wall_strike.0;
        let put_wall = opt.put_wall_strike.0;
        let max_pain = opt.max_pain_strike.0;
        let cur = last_price_ticks.0;

        let mut opt_text = format!("PCR = {:.2} ({})", pcr, if pcr > 1.0 { "Thiên hướng Bán bảo hiểm" } else { "Thiên hướng Kỳ vọng Tăng" });

        if call_wall > 0 && (call_wall - cur).abs() < (cur / 50).max(1000) {
            opt_text += &format!(" | Giá đang áp sát Call Wall ({}) - Kháng cự cực mạnh của các Market Makers!", call_wall);
        } else if put_wall > 0 && (cur - put_wall).abs() < (cur / 50).max(1000) {
            opt_text += &format!(" | Giá đang chạm Put Wall ({}) - Vùng đệm hỗ trợ dày đặc được phe MM bảo vệ!", put_wall);
        } else if max_pain > 0 {
            opt_text += &format!(" | Max Pain Strike tại {} - Nam châm hút giá ngày đáo hạn.", max_pain);
        }

        options_confluence = opt_text;
    }

    MarketNarrative {
        sentiment,
        headline,
        order_flow_summary,
        options_confluence,
        institutional_bias,
        risk_alert,
    }
}
