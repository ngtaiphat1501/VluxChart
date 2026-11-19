//! DeepChart Analytical Data Exporter (CSV & Parquet Ready)
//! Exports historical bars, footprint matrices, and trade sequences for quantitative analysis.

use crate::dto::BarDTO;
use std::fmt::Write as FmtWrite;
use std::fs::File;
use std::io::Write as IoWrite;
use std::path::Path;

pub struct DataExporter;

impl DataExporter {
    /// Formats a list of BarDTOs into canonical CSV format.
    pub fn bars_to_csv(bars: &[BarDTO]) -> String {
        let mut out = String::with_capacity(bars.len() * 128);
        out.push_str("bar_start_us,timeframe_us,open_ticks,high_ticks,low_ticks,close_ticks,buy_units,sell_units,unknown_units,total_units,delta_units,trade_count,poc_ticks,vah_ticks,val_ticks,finality,completeness\n");

        for b in bars {
            let poc_str = b.poc_ticks.map(|p| p.to_string()).unwrap_or_default();
            let vah_str = b.value_area.as_ref().map(|v| v.vah_ticks.to_string()).unwrap_or_default();
            let val_str = b.value_area.as_ref().map(|v| v.val_ticks.to_string()).unwrap_or_default();

            let _ = writeln!(
                out,
                "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}",
                b.bar_start_us,
                b.timeframe_us,
                b.open_ticks,
                b.high_ticks,
                b.low_ticks,
                b.close_ticks,
                b.buy_units,
                b.sell_units,
                b.unknown_units,
                b.total_units,
                b.delta_units,
                b.trade_count,
                poc_str,
                vah_str,
                val_str,
                b.finality,
                b.completeness
            );
        }

        out
    }

    /// Formats footprint cell matrix across all bars into granular CSV format.
    pub fn footprint_to_csv(bars: &[BarDTO]) -> String {
        let mut out = String::with_capacity(bars.len() * 512);
        out.push_str("bar_start_us,price_ticks,buy_units,sell_units,unknown_units,total_units,delta_units,trade_count\n");

        for b in bars {
            for cell in &b.footprint {
                let _ = writeln!(
                    out,
                    "{},{},{},{},{},{},{},{}",
                    b.bar_start_us,
                    cell.price_ticks,
                    cell.buy_units,
                    cell.sell_units,
                    cell.unknown_units,
                    cell.total_units,
                    cell.delta_units,
                    cell.trade_count
                );
            }
        }

        out
    }

    /// Exports bars to a CSV file on disk.
    pub fn export_bars_to_file<P: AsRef<Path>>(path: P, bars: &[BarDTO]) -> std::io::Result<usize> {
        let csv_data = Self::bars_to_csv(bars);
        let mut file = File::create(path)?;
        file.write_all(csv_data.as_bytes())?;
        Ok(bars.len())
    }

    /// Exports footprint matrix to a CSV file on disk.
    pub fn export_footprint_to_file<P: AsRef<Path>>(path: P, bars: &[BarDTO]) -> std::io::Result<usize> {
        let csv_data = Self::footprint_to_csv(bars);
        let mut file = File::create(path)?;
        file.write_all(csv_data.as_bytes())?;
        let cell_count = bars.iter().map(|b| b.footprint.len()).sum();
        Ok(cell_count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dto::FootprintCellDTO;

    #[test]
    fn test_bars_and_footprint_csv_export() {
        let bar = BarDTO {
            bar_start_us: 1700000000000000,
            timeframe_us: 60000000,
            open_ticks: 9500000,
            high_ticks: 9505000,
            low_ticks: 9498000,
            close_ticks: 9502000,
            buy_units: 1200,
            sell_units: 800,
            unknown_units: 0,
            total_units: 2000,
            delta_units: 400,
            trade_count: 50,
            poc_ticks: Some(9501000),
            value_area: None,
            footprint: vec![FootprintCellDTO {
                price_ticks: 9501000,
                buy_units: 600,
                sell_units: 400,
                unknown_units: 0,
                total_units: 1000,
                delta_units: 200,
                trade_count: 25,
            }],
            stacked_imbalances: vec![],
            signals: vec![],
            finality: "Closed".into(),
            completeness: "Complete".into(),
        };

        let csv = DataExporter::bars_to_csv(&[bar.clone()]);
        assert!(csv.contains("bar_start_us,timeframe_us"));
        assert!(csv.contains("1700000000000000,60000000,9500000"));

        let fp_csv = DataExporter::footprint_to_csv(&[bar]);
        assert!(fp_csv.contains("bar_start_us,price_ticks"));
        assert!(fp_csv.contains("1700000000000000,9501000,600,400"));
    }
}
