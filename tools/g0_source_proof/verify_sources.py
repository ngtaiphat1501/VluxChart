"""
DeepChart Gate G0: Live Feed Capture and Source Verification Tool (Updated)
Author: DeepChart Core Team
"""

import asyncio
import json
import hashlib
import time
import urllib.request
from pathlib import Path
import websockets

BASE_DIR = Path(__file__).resolve().parent.parent.parent
BYBIT_FIXTURE_PATH = BASE_DIR / "fixtures" / "raw" / "bybit" / "sample_bybit_trades.jsonl"
BINANCE_FIXTURE_PATH = BASE_DIR / "fixtures" / "raw" / "binance" / "sample_binance_aggtrades.jsonl"
GOLD_FIXTURE_PATH = BASE_DIR / "fixtures" / "raw" / "binance" / "sample_binance_xauusdt_aggtrades.jsonl"
REPORT_PATH = BASE_DIR / "docs" / "source-proof" / "capture_and_validation_report.json"

def compute_sha256(file_path: Path) -> str:
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()

async def capture_bybit_trades(target_count=35, timeout_sec=15):
    url = "wss://stream.bybit.com/v5/public/linear"
    sub_msg = {
        "op": "subscribe",
        "args": ["publicTrade.BTCUSDT", "publicTrade.ETHUSDT"]
    }
    
    trades_captured = []
    messages_captured = []
    start_time = time.time()
    
    print(f"Connecting to Bybit WebSocket: {url}...")
    async with websockets.connect(url, open_timeout=5, ping_interval=20, ping_timeout=10) as ws:
        await ws.send(json.dumps(sub_msg))
        print("Subscribed to publicTrade.BTCUSDT and publicTrade.ETHUSDT")
        
        while len(trades_captured) < target_count and (time.time() - start_time) < timeout_sec:
            raw_msg = await asyncio.wait_for(ws.recv(), timeout=5)
            recv_ts_us = int(time.time() * 1_000_000)
            data = json.loads(raw_msg)
            
            if data.get("topic", "").startswith("publicTrade.") and "data" in data:
                messages_captured.append({"recv_ts_us": recv_ts_us, "payload": data})
                for t in data["data"]:
                    trades_captured.append({
                        "recv_ts_us": recv_ts_us,
                        "exchange_ts_ms": t.get("T"),
                        "symbol": t.get("s"),
                        "side": t.get("S"),
                        "volume": t.get("v"),
                        "price": t.get("p"),
                        "trade_id": t.get("i"),
                        "block_trade": t.get("BT")
                    })
                    if len(trades_captured) >= target_count:
                        break

    BYBIT_FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(BYBIT_FIXTURE_PATH, "w", encoding="utf-8") as f:
        for item in messages_captured:
            f.write(json.dumps(item) + "\n")
            
    print(f"Bybit capture complete: {len(trades_captured)} trades in {len(messages_captured)} messages.")
    return {
        "status": "PASS" if len(trades_captured) >= 20 else "FAIL",
        "venue": "BYBIT",
        "market": "LINEAR_PERP",
        "feed": "publicTrade",
        "trade_count": len(trades_captured),
        "message_count": len(messages_captured),
        "fixture_path": str(BYBIT_FIXTURE_PATH.relative_to(BASE_DIR)),
        "sha256": compute_sha256(BYBIT_FIXTURE_PATH),
        "sample_trades": trades_captured[:3]
    }

async def capture_binance_stream(stream_name, output_path, target_count=30, timeout_sec=15):
    # Fallback hosts
    candidate_hosts = [
        "fstream.binancefuture.com",
        "stream.binance.com:9443",
        "fstream.binance.com"
    ]
    
    trades_captured = []
    messages_captured = []
    connected_host = None
    
    for host in candidate_hosts:
        url = f"wss://{host}/ws/{stream_name}"
        print(f"Connecting to Binance stream: {url}...")
        try:
            async with websockets.connect(url, open_timeout=5, ping_interval=20, ping_timeout=10) as ws:
                connected_host = host
                start_time = time.time()
                while len(trades_captured) < target_count and (time.time() - start_time) < timeout_sec:
                    raw_msg = await asyncio.wait_for(ws.recv(), timeout=5)
                    recv_ts_us = int(time.time() * 1_000_000)
                    data = json.loads(raw_msg)
                    
                    if data.get("e") == "aggTrade":
                        messages_captured.append({"recv_ts_us": recv_ts_us, "payload": data})
                        taker_side = "SELL" if data.get("m") else "BUY"
                        trades_captured.append({
                            "recv_ts_us": recv_ts_us,
                            "exchange_ts_ms": data.get("T"),
                            "symbol": data.get("s"),
                            "agg_trade_id": data.get("a"),
                            "price": data.get("p"),
                            "quantity": data.get("q"),
                            "first_trade_id": data.get("f"),
                            "last_trade_id": data.get("l"),
                            "is_buyer_maker": data.get("m"),
                            "aggressor_side": taker_side
                        })
                break
        except Exception as e:
            print(f"Failed host {host}: {type(e).__name__} - {e}. Trying next...")
            continue

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        for item in messages_captured:
            f.write(json.dumps(item) + "\n")
            
    print(f"Binance stream {stream_name} capture complete: {len(trades_captured)} aggTrades from {connected_host}.")
    return {
        "status": "PASS" if len(trades_captured) >= 10 else "FAIL",
        "venue": "BINANCE",
        "host_used": connected_host,
        "stream": stream_name,
        "trade_count": len(trades_captured),
        "fixture_path": str(output_path.relative_to(BASE_DIR)),
        "sha256": compute_sha256(output_path),
        "sample_trades": trades_captured[:3]
    }

def verify_gold_instruments():
    print("Verifying Gold symbols on Binance Futures and Spot...")
    results = {}
    
    # 1. Binance USD(S)-M Futures exchangeInfo
    try:
        req = urllib.request.Request("https://fapi.binance.com/fapi/v1/exchangeInfo", headers={"User-Agent": "DeepChart-G0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            futures_symbols = [s["symbol"] for s in data.get("symbols", [])]
            results["binance_futures"] = {
                "accessible": True,
                "total_symbols": len(futures_symbols),
                "xauusdt_present": "XAUUSDT" in futures_symbols,
                "paxgusdt_present": "PAXGUSDT" in futures_symbols
            }
            if "XAUUSDT" in futures_symbols:
                sym_info = next(s for s in data["symbols"] if s["symbol"] == "XAUUSDT")
                price_filter = next(f for f in sym_info["filters"] if f["filterType"] == "PRICE_FILTER")
                lot_filter = next(f for f in sym_info["filters"] if f["filterType"] == "LOT_SIZE")
                results["binance_futures"]["xauusdt_details"] = {
                    "symbol": sym_info["symbol"],
                    "contractType": sym_info["contractType"],
                    "status": sym_info["status"],
                    "baseAsset": sym_info["baseAsset"],
                    "quoteAsset": sym_info["quoteAsset"],
                    "pricePrecision": sym_info["pricePrecision"],
                    "quantityPrecision": sym_info["quantityPrecision"],
                    "tickSize": price_filter["tickSize"],
                    "stepSize": lot_filter["stepSize"]
                }
    except Exception as e:
        results["binance_futures"] = {"accessible": False, "error": str(e)}

    # 2. Binance Spot
    try:
        req = urllib.request.Request("https://api.binance.com/api/v3/exchangeInfo", headers={"User-Agent": "DeepChart-G0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            spot_symbols = [s["symbol"] for s in data.get("symbols", [])]
            results["binance_spot"] = {
                "accessible": True,
                "xauusdt_present": "XAUUSDT" in spot_symbols,
                "paxgusdt_present": "PAXGUSDT" in spot_symbols
            }
    except Exception as e:
        results["binance_spot"] = {"accessible": False, "error": str(e)}

    # 3. Bybit Linear Symbols
    try:
        req = urllib.request.Request("https://api.bybit.com/v5/market/instruments-info?category=linear", headers={"User-Agent": "DeepChart-G0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            bybit_symbols = [s["symbol"] for s in data.get("result", {}).get("list", [])]
            results["bybit_linear"] = {
                "accessible": True,
                "xauusdt_present": "XAUUSDT" in bybit_symbols,
                "paxgusdt_present": "PAXGUSDT" in bybit_symbols
            }
    except Exception as e:
        results["bybit_linear"] = {"accessible": False, "error": str(e)}

    return results

async def main():
    print("=== DEEPCHART GATE G0: SOURCE PROOF VERIFICATION ===")
    
    # 1. Capture Bybit BTC & ETH
    bybit_result = await capture_bybit_trades(target_count=35, timeout_sec=10)
    
    # 2. Capture Binance BTC
    binance_btc_result = await capture_binance_stream("btcusdt@aggTrade", BINANCE_FIXTURE_PATH, target_count=30, timeout_sec=10)
    
    # 3. Capture Binance XAUUSDT (Gold)
    binance_gold_result = await capture_binance_stream("xauusdt@aggTrade", GOLD_FIXTURE_PATH, target_count=15, timeout_sec=10)
    
    # 4. Verify Gold Instruments metadata
    gold_metadata = verify_gold_instruments()
    
    full_report = {
        "gate": "G0_SOURCE_PROOF",
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "bybit_verification": bybit_result,
        "binance_btc_verification": binance_btc_result,
        "binance_gold_verification": binance_gold_result,
        "gold_metadata": gold_metadata,
        "conclusion": {
            "btc_eth_source_proven": (bybit_result["status"] == "PASS" and binance_btc_result["status"] == "PASS"),
            "gold_instrument_status": "VERIFIED_PASS" if (binance_gold_result["status"] == "PASS" and gold_metadata.get("binance_futures", {}).get("xauusdt_present")) else "UNVERIFIED"
        }
    }
    
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(full_report, f, indent=2)
        
    print(f"\nVerification report generated at: {REPORT_PATH}")
    print(f"BTC/ETH Source Proven: {full_report['conclusion']['btc_eth_source_proven']}")
    print(f"Gold Instrument Status: {full_report['conclusion']['gold_instrument_status']}")

if __name__ == "__main__":
    asyncio.run(main())
