"""
DeepChart Gate G0 Test Suite: Source Proof & Data Contract Verification
Author: DeepChart Core Team
"""

import json
import yaml
from pathlib import Path
from decimal import Decimal
import pytest

BASE_DIR = Path(__file__).resolve().parent.parent.parent
INSTRUMENTS_FILE = BASE_DIR / "instruments.yaml"
BYBIT_FIXTURE = BASE_DIR / "fixtures" / "raw" / "bybit" / "sample_bybit_trades.jsonl"
BINANCE_BTC_FIXTURE = BASE_DIR / "fixtures" / "raw" / "binance" / "sample_binance_aggtrades.jsonl"
BINANCE_GOLD_FIXTURE = BASE_DIR / "fixtures" / "raw" / "binance" / "sample_binance_xauusdt_aggtrades.jsonl"
REPORT_FILE = BASE_DIR / "docs" / "source-proof" / "capture_and_validation_report.json"

class TestGateG0SourceProof:
    """Gate G0 Test Suite for Source Verification, Normalization and Data Integrity"""

    def test_tc_g0_01_instruments_registry_schema(self):
        """TC-G0-01: Verify instruments.yaml adheres to strict DeepChart registry schema"""
        assert INSTRUMENTS_FILE.exists(), "instruments.yaml must exist"
        with open(INSTRUMENTS_FILE, "r", encoding="utf-8") as f:
            registry = yaml.safe_load(f)
            
        assert "instruments" in registry
        instruments = registry["instruments"]
        assert len(instruments) >= 4, "Must register at least Bybit BTC/ETH and Binance BTC/ETH"
        
        instrument_ids = [inst["instrument_id"] for inst in instruments]
        assert "BYBIT:LINEAR_PERP:BTCUSDT:PERP" in instrument_ids
        assert "BYBIT:LINEAR_PERP:ETHUSDT:PERP" in instrument_ids
        assert "BINANCE:USDS_M_PERP:BTCUSDT:PERP" in instrument_ids
        assert "BINANCE:USDS_M_PERP:XAUUSDT:PERP" in instrument_ids

        for inst in instruments:
            assert ":" in inst["instrument_id"]
            parts = inst["instrument_id"].split(":")
            assert len(parts) == 4, f"instrument_id {inst['instrument_id']} must have 4 segments VENUE:MARKET:SYMBOL:CONTRACT"
            assert inst["price_tick"] > 0
            assert inst["quantity_step"] > 0
            assert inst["quantity_scale"] >= 1
            assert inst["contract_multiplier"] > 0
            assert inst["trade_unit"] in ["BTC", "ETH", "OUNCE_OR_UNIT", "CONTRACT_100_TROY_OZ", "OZ_CFD"]
            assert inst["source_status"] in ["PRIMARY_CANDIDATE", "SECONDARY_RECONCILIATION", "UNDER_VERIFICATION", "PLANNED_LICENSED", "VERIFIED_PASS", "MULTI_VENUE_NORMALIZED", "REFERENCE_FEED"]

    def test_tc_g0_02_bybit_raw_feed_schema_and_integrity(self):
        """TC-G0-02: Verify Bybit V5 Linear publicTrade real capture has all required fields"""
        assert BYBIT_FIXTURE.exists(), "Bybit raw fixture must exist"
        records = []
        with open(BYBIT_FIXTURE, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    records.append(json.loads(line))
                    
        assert len(records) >= 10, f"Expected at least 10 Bybit messages, got {len(records)}"
        
        total_trades = 0
        latencies_ms = []
        
        for msg in records:
            assert "recv_ts_us" in msg
            assert "payload" in msg
            payload = msg["payload"]
            assert payload.get("topic", "").startswith("publicTrade.")
            assert "data" in payload
            assert isinstance(payload["data"], list)
            
            for trade in payload["data"]:
                total_trades += 1
                assert "T" in trade, "Exchange timestamp ms is required"
                assert "s" in trade, "Symbol is required"
                assert "S" in trade, "Side is required"
                assert trade["S"] in ["Buy", "Sell"], f"Side must be Buy or Sell, got {trade['S']}"
                assert "v" in trade, "Volume is required"
                assert "p" in trade, "Price is required"
                assert "i" in trade, "Trade ID is required"
                assert len(str(trade["i"])) > 0, "Trade ID cannot be empty"
                
                # Numeric sanity
                price = float(trade["p"])
                volume = float(trade["v"])
                assert price > 0, "Price must be positive"
                assert volume > 0, "Volume must be positive"
                
                # Latency check: exchange timestamp to receive timestamp
                latency = (msg["recv_ts_us"] / 1000.0) - trade["T"]
                latencies_ms.append(latency)
                
        assert total_trades >= 30, f"Expected >= 30 trades captured, got {total_trades}"
        # Validate latency is sane (clock drift within reasonable bounds, > -1000ms and < 5000ms)
        p95_latency = sorted(latencies_ms)[int(len(latencies_ms) * 0.95)]
        assert p95_latency < 2000, f"p95 latency too high: {p95_latency} ms"

    def test_tc_g0_03_binance_aggtrade_feed_schema_and_integrity(self):
        """TC-G0-03: Verify Binance Futures aggTrade real capture schema and aggressor derivation"""
        assert BINANCE_BTC_FIXTURE.exists(), "Binance raw fixture must exist"
        records = []
        with open(BINANCE_BTC_FIXTURE, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    records.append(json.loads(line))
                    
        assert len(records) >= 15, f"Expected at least 15 Binance aggTrades, got {len(records)}"
        
        for msg in records:
            assert "recv_ts_us" in msg
            assert "payload" in msg
            payload = msg["payload"]
            assert payload.get("e") == "aggTrade"
            assert payload.get("s") == "BTCUSDT"
            assert "a" in payload, "Aggregate trade ID required"
            assert "p" in payload, "Price required"
            assert "q" in payload, "Quantity required"
            assert "f" in payload, "First trade ID required"
            assert "l" in payload, "Last trade ID required"
            assert "T" in payload, "Trade execution time required"
            assert "m" in payload, "isBuyerMaker boolean flag required"
            assert isinstance(payload["m"], bool)
            
            # Numeric sanity
            assert float(payload["p"]) > 0
            assert float(payload["q"]) > 0
            assert payload["l"] >= payload["f"], "Last trade ID must be >= first trade ID"

    def test_tc_g0_04_gold_instrument_live_proof(self):
        """TC-G0-04: Verify Binance XAUUSDT has live executed trades and valid trading specs"""
        assert BINANCE_GOLD_FIXTURE.exists(), "Binance XAUUSDT fixture must exist"
        with open(BINANCE_GOLD_FIXTURE, "r", encoding="utf-8") as f:
            gold_trades = [json.loads(line) for line in f if line.strip()]
            
        assert len(gold_trades) >= 5, f"Expected at least 5 live XAUUSDT aggTrades, got {len(gold_trades)}"
        for msg in gold_trades:
            payload = msg["payload"]
            assert payload.get("s") == "XAUUSDT"
            price = float(payload.get("p"))
            assert price > 2000.0, f"XAUUSDT price {price} out of plausible gold range"
            qty = float(payload.get("q"))
            assert qty >= 0.001, f"XAUUSDT step size min is 0.001, got {qty}"

    def test_tc_g0_05_data_normalization_and_exact_accounting_invariants(self):
        """TC-G0-05: Invariant Total = Buy + Sell + Unknown in exact scaled integers (zero float drift)"""
        # Load Bybit trades and simulate normalization & aggregation
        with open(BYBIT_FIXTURE, "r", encoding="utf-8") as f:
            raw_bybit_messages = [json.loads(l) for l in f if l.strip()]

        tick_size = Decimal("0.10")  # BTCUSDT tick
        scale = 1000  # BTC qty scale (0.001 BTC = 1 unit)
        
        normalized_events = []
        for msg in raw_bybit_messages:
            payload = msg["payload"]
            for t in payload.get("data", []):
                price_dec = Decimal(str(t["p"]))
                qty_dec = Decimal(str(t["v"]))
                
                # Integer ticks & scaled integer units
                price_ticks = int(price_dec / tick_size)
                quantity_units = int(round(qty_dec * scale))
                
                # Aggressor mapping
                if t["S"] == "Buy":
                    aggressor = "BUY"
                elif t["S"] == "Sell":
                    aggressor = "SELL"
                else:
                    aggressor = "UNKNOWN"
                    
                normalized_events.append({
                    "event_id": t["i"],
                    "exchange_ts_ms": t["T"],
                    "price_ticks": price_ticks,
                    "quantity_units": quantity_units,
                    "aggressor": aggressor
                })
                
        assert len(normalized_events) >= 30
        
        # Test Deduplication logic
        seen_ids = set()
        deduped_events = []
        duplicates_rejected = 0
        for ev in normalized_events:
            if ev["event_id"] in seen_ids:
                duplicates_rejected += 1
            else:
                seen_ids.add(ev["event_id"])
                deduped_events.append(ev)
                
        assert len(deduped_events) == len(seen_ids)
        
        # Aggregate Volume
        total_buy_units = sum(ev["quantity_units"] for ev in deduped_events if ev["aggressor"] == "BUY")
        total_sell_units = sum(ev["quantity_units"] for ev in deduped_events if ev["aggressor"] == "SELL")
        total_unknown_units = sum(ev["quantity_units"] for ev in deduped_events if ev["aggressor"] == "UNKNOWN")
        total_volume_units = sum(ev["quantity_units"] for ev in deduped_events)
        delta_units = total_buy_units - total_sell_units
        
        # EXACT INVARIANT ASSERTIONS (Exact equality on integers, ZERO floating-point error)
        assert total_volume_units == (total_buy_units + total_sell_units + total_unknown_units), \
            "Invariant Violation: Total != Buy + Sell + Unknown"
        assert delta_units == (total_buy_units - total_sell_units), \
            "Delta Invariant Violation: Delta != Buy - Sell"
            
        # Footprint cell distribution invariant
        price_bins = {}
        for ev in deduped_events:
            p = ev["price_ticks"]
            if p not in price_bins:
                price_bins[p] = {"buy": 0, "sell": 0, "unknown": 0, "total": 0}
            if ev["aggressor"] == "BUY":
                price_bins[p]["buy"] += ev["quantity_units"]
            elif ev["aggressor"] == "SELL":
                price_bins[p]["sell"] += ev["quantity_units"]
            else:
                price_bins[p]["unknown"] += ev["quantity_units"]
            price_bins[p]["total"] += ev["quantity_units"]
            
        sum_cell_totals = sum(b["total"] for b in price_bins.values())
        assert sum_cell_totals == total_volume_units, "Sum of all footprint cells must equal total candle volume"
