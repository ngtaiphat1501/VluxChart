/**
 * DeepChart — Real MetaTrader 5 (MT5) Terminal Bridge & Direct Execution Service
 * Connects directly to the installed Windows MetaTrader 5 terminal via:
 * 1. Local HTTP RPC daemon (http://127.0.0.1:15556) backed by official MetaTrader5 Python C-API
 * 2. Tauri Native IPC command (`mt5_bridge_exec`) fallback
 *
 * Capabilities:
 * - Reads REAL MT5 Account Info (Login, Server, Name, Balance, Equity, Floating Profit, Free Margin)
 * - Switches / Logs in to any MT5 Account (`mt5.login(login, password, server)`)
 * - Reads REAL MT5 Open Positions (`mt5.positions_get`) & Pending Orders (`mt5.orders_get`)
 * - Fetches REAL MT5 Historical OHLCV + Tick Footprints (`mt5.copy_rates_from_pos` + `mt5.copy_ticks_range`)
 * - Strictly respects REAL Market Hours (No fake weekend ticks when Forex/Gold market is closed!)
 * - Executes REAL Orders (`mt5.order_send` Market, Limit, Stop, SL/TP Modify, Position Close, Flatten)
 */

import { BarDTO, OrderBookSnapshotDTO, TradeEventDTO } from '../types';
import { computePositionPnlUsd, getInstrumentMeta } from '../utils/instrumentRegistry';

export type Mt5BrokerPreset = 'Exness' | 'FTMO' | 'ICMarkets' | 'Pepperstone' | 'XM' | 'MetaQuotes' | string;

export interface Mt5AccountConfig {
  broker: Mt5BrokerPreset;
  server: string;
  login: string;
  password?: string;
  accountName: string;
  leverage: string | number;
  currency: string;
  balance: number;
  balanceUsd: number;
  equityUsd: number;
  floatingPnlUsd?: number;
  marginFreeUsd?: number;
  bridgeUrl: string;
  isConnected: boolean;
  connected: boolean;
  isRealMt5Terminal?: boolean;
  marketOpen?: boolean;
  connectionMode: 'MT5_DIRECT_ECN' | 'MT5_LOCAL_BRIDGE' | 'LOCAL_WS_BRIDGE' | 'DIRECT_ECN_SIM';
  lastPingMs: number;
  lastError?: string | null;
  lastOrderFeedback?: { ok: boolean; message: string; timestamp: number } | null;
}

export interface Mt5OrderTicket {
  ticket: number;
  instrumentId: string;
  symbol: string;
  side: 'Buy' | 'Sell';
  orderType: 'MARKET' | 'LIMIT' | 'STOP';
  status: 'OPEN' | 'PENDING' | 'CLOSED';
  isFilled: boolean;
  lots: number;
  entryPriceTicks: number;
  currentPriceTicks?: number;
  slPriceTicks: number | null;
  tpPriceTicks: number | null;
  slTicks: number | null;
  tpTicks: number | null;
  profitUsd?: number;
  swapUsd?: number;
  openTimeUs: number;
  comment: string;
  linkedDrawingId?: string;
}

export interface RiskManagerRules {
  maxDailyLossUsd: number;
  maxOpenLots: number;
  isLockoutEnabled: boolean;
  trailingDdPct: number;
}

const MT5_ACCOUNT_STORAGE_KEY = 'deepchart_mt5_account_v3';
const MT5_TICKETS_STORAGE_KEY = 'deepchart_mt5_tickets_v2';
const RISK_RULES_STORAGE_KEY = 'deepchart_risk_rules_v1';
const MT5_HTTP_BRIDGE_URL = 'http://127.0.0.1:15556';

const DEFAULT_RISK_RULES: RiskManagerRules = {
  maxDailyLossUsd: 500,
  maxOpenLots: 2.0,
  isLockoutEnabled: true,
  trailingDdPct: 3.0,
};

export const MT5_BROKER_SERVERS: { broker: string; servers: string[] }[] = [
  {
    broker: 'Exness',
    servers: [
      'Exness-MT5Trial8',
      'Exness-MT5Trial7',
      'Exness-MT5Trial9',
      'Exness-MT5Trial10',
      'Exness-MT5Real9',
      'Exness-MT5Real15',
      'Exness-MT5Real20',
    ],
  },
  {
    broker: 'FTMO',
    servers: ['FTMO-Server', 'FTMO-Server2', 'FTMO-Server3', 'FTMO-Demo'],
  },
  {
    broker: 'ICMarkets',
    servers: ['ICMarketsSC-MT5-2', 'ICMarketsSC-MT5-4', 'ICMarketsSC-Demo02'],
  },
  {
    broker: 'Pepperstone',
    servers: ['Pepperstone-MT5-Live01', 'Pepperstone-MT5-Edge02', 'Pepperstone-Demo01'],
  },
  {
    broker: 'XM / MetaQuotes',
    servers: ['XMGlobal-MT5-2', 'VantageInternational-Live', 'MetaQuotes-Demo'],
  },
];

const DEFAULT_MT5_ACCOUNT: Mt5AccountConfig = {
  broker: 'Exness',
  server: '',
  login: '',
  accountName: 'Chưa kết nối MetaTrader 5',
  leverage: 100,
  currency: 'USD',
  balance: 0,
  balanceUsd: 0,
  equityUsd: 0,
  floatingPnlUsd: 0,
  marginFreeUsd: 0,
  bridgeUrl: MT5_HTTP_BRIDGE_URL,
  isConnected: false,
  connected: false,
  isRealMt5Terminal: false,
  marketOpen: false,
  connectionMode: 'LOCAL_WS_BRIDGE',
  lastPingMs: 0,
  lastError: null,
  lastOrderFeedback: null,
};

type Listener = () => void;

class Mt5BridgeService {
  private account: Mt5AccountConfig;
  private tickets: Mt5OrderTicket[];
  private riskRules: RiskManagerRules;
  private listeners: Set<Listener> = new Set();
  private realizedDailyPnlUsd: number = 0;
  private bridgeUnavailableUntilMs: number = 0;

  constructor() {
    this.account = this.loadAccount();
    this.tickets = this.loadTickets();
    this.riskRules = this.loadRiskRules();
    // Attempt non-blocking sync with local MT5 terminal if installed
    setTimeout(() => {
      this.syncFromRealMt5();
    }, 150);
  }

  private loadRiskRules(): RiskManagerRules {
    try {
      const raw = localStorage.getItem(RISK_RULES_STORAGE_KEY);
      if (raw) {
        return { ...DEFAULT_RISK_RULES, ...JSON.parse(raw) };
      }
    } catch {}
    return { ...DEFAULT_RISK_RULES };
  }

  getRiskRules(): RiskManagerRules {
    return { ...this.riskRules };
  }

  saveRiskRules(patch: Partial<RiskManagerRules>): RiskManagerRules {
    this.riskRules = {
      ...this.riskRules,
      ...patch,
      maxDailyLossUsd: Math.max(10, Number(patch.maxDailyLossUsd ?? this.riskRules.maxDailyLossUsd)),
      maxOpenLots: Math.max(0.01, Number(patch.maxOpenLots ?? this.riskRules.maxOpenLots)),
      trailingDdPct: Math.max(0.5, Number(patch.trailingDdPct ?? this.riskRules.trailingDdPct)),
    };
    try {
      localStorage.setItem(RISK_RULES_STORAGE_KEY, JSON.stringify(this.riskRules));
    } catch {}
    this.notify();
    return this.getRiskRules();
  }

  getRiskStatus(): { dailyPnlUsd: number; openLots: number; isBreached: boolean; reason: string | null } {
    const dailyPnlUsd = Number(((this.account.floatingPnlUsd || 0) + this.realizedDailyPnlUsd).toFixed(2));
    const openLots = Number(
      this.tickets
        .filter((t) => t.status === 'OPEN')
        .reduce((sum, t) => sum + (t.lots || 0), 0)
        .toFixed(2)
    );
    if (this.riskRules.isLockoutEnabled && dailyPnlUsd <= -this.riskRules.maxDailyLossUsd) {
      return {
        dailyPnlUsd,
        openLots,
        isBreached: true,
        reason: `Chạm giới hạn lỗ ngày (-$${this.riskRules.maxDailyLossUsd.toLocaleString()})`,
      };
    }
    return { dailyPnlUsd, openLots, isBreached: false, reason: null };
  }

  private normalizeAccount(acct: Partial<Mt5AccountConfig>): Mt5AccountConfig {
    const bal =
      typeof acct.balanceUsd === 'number'
        ? acct.balanceUsd
        : typeof acct.balance === 'number'
        ? acct.balance
        : 0;
    const eq = typeof acct.equityUsd === 'number' ? acct.equityUsd : bal;
    const conn = acct.connected ?? acct.isConnected ?? false;
    return {
      ...DEFAULT_MT5_ACCOUNT,
      ...acct,
      balance: bal,
      balanceUsd: bal,
      equityUsd: eq,
      isConnected: conn,
      connected: conn,
    };
  }

  private normalizeTicket(t: any): Mt5OrderTicket {
    const sl = t.slTicks ?? t.slPriceTicks ?? null;
    const tp = t.tpTicks ?? t.tpPriceTicks ?? null;
    const isFilled = t.status ? t.status === 'OPEN' : Boolean(t.isFilled);
    const status: 'OPEN' | 'PENDING' | 'CLOSED' = t.status || (isFilled ? 'OPEN' : 'PENDING');
    return {
      ...t,
      status,
      isFilled,
      slPriceTicks: sl,
      tpPriceTicks: tp,
      slTicks: sl,
      tpTicks: tp,
    };
  }

  private loadAccount(): Mt5AccountConfig {
    try {
      const raw = localStorage.getItem(MT5_ACCOUNT_STORAGE_KEY);
      if (raw) {
        return this.normalizeAccount(JSON.parse(raw));
      }
    } catch {}
    return DEFAULT_MT5_ACCOUNT;
  }

  private saveAccount() {
    try {
      const copy = { ...this.account };
      delete copy.password; // Never persist plain password in localStorage
      localStorage.setItem(MT5_ACCOUNT_STORAGE_KEY, JSON.stringify(copy));
    } catch {}
  }

  private loadTickets(): Mt5OrderTicket[] {
    try {
      const raw = localStorage.getItem(MT5_TICKETS_STORAGE_KEY);
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          return list.map((t) => this.normalizeTicket(t));
        }
      }
    } catch {}
    return [];
  }

  private saveTickets() {
    try {
      localStorage.setItem(MT5_TICKETS_STORAGE_KEY, JSON.stringify(this.tickets));
    } catch {}
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  getAccount(): Mt5AccountConfig {
    return this.account;
  }

  private isSameInstrumentOrBase(ticketInstId: string, queryInstId: string): boolean {
    if (ticketInstId === queryInstId) return true;
    const norm = (id: string) => {
      if (id.includes('BTC')) return 'BTC';
      if (id.includes('ETH')) return 'ETH';
      if (id.includes('XAU')) return 'XAU';
      if (id.includes('EURUSD')) return 'EURUSD';
      if (id.includes('GBPUSD')) return 'GBPUSD';
      if (id.includes('USDJPY')) return 'USDJPY';
      if (id.includes('AUDUSD')) return 'AUDUSD';
      if (id.includes('USDCAD')) return 'USDCAD';
      if (id.includes('GBPJPY')) return 'GBPJPY';
      if (id.includes('NAS100') || id.includes('USTEC')) return 'NAS100';
      if (id.includes('US30')) return 'US30';
      return id;
    };
    return norm(ticketInstId) === norm(queryInstId);
  }

  getTickets(instrumentId?: string): Mt5OrderTicket[] {
    if (!instrumentId) return this.tickets;
    return this.tickets.filter((t) => this.isSameInstrumentOrBase(t.instrumentId, instrumentId));
  }

  getRealizedDailyPnl(): number {
    return this.realizedDailyPnlUsd;
  }

  /**
   * Executes a JSON RPC payload against the real MetaTrader 5 terminal via:
   * 1. Fast persistent local HTTP server (http://127.0.0.1:15556)
   * 2. Native Tauri command (`mt5_bridge_exec`) fallback
   */
  async callMt5Rpc(
    payload: Record<string, any>,
    options?: { allowCliFallback?: boolean; timeoutMs?: number }
  ): Promise<any> {
    const allowCli = options?.allowCliFallback ?? false;
    const timeoutMs = options?.timeoutMs ?? 1200;

    // Circuit breaker: avoid freezing UI on repeated background polls when MT5 bridge daemon isn't running
    if (!allowCli && Date.now() < this.bridgeUnavailableUntilMs) {
      return { ok: false, error: 'MT5 Local Bridge tạm thời chưa phản hồi (cooldown)' };
    }

    // 1. Try local persistent HTTP daemon first (< 5ms latency)
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(MT5_HTTP_BRIDGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (resp.ok) {
        this.bridgeUnavailableUntilMs = 0;
        return await resp.json();
      }
    } catch (err: any) {
      // Only set cooldown on genuine connection refusal (not on a slow historical bars query)
      const isAbort = err && (err.name === 'AbortError' || String(err).includes('aborted'));
      if (!allowCli && !isAbort && payload.action !== 'bars') {
        this.bridgeUnavailableUntilMs = Date.now() + 6_000;
      }
    }

    // 2. Only invoke cold Python CLI subprocess when explicitly requested (login/order/manual sync)
    if (allowCli) {
      try {
        if ((window as any).__TAURI_INTERNALS__) {
          const { invoke } = await import('@tauri-apps/api/core');
          const outStr = await invoke<string>('mt5_bridge_exec', {
            payload: JSON.stringify(payload),
          });
          if (outStr) {
            this.bridgeUnavailableUntilMs = 0;
            return JSON.parse(outStr);
          }
        }
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }

    return { ok: false, error: 'Không thể kết nối tới MT5 Local Bridge (http://127.0.0.1:15556)' };
  }

  private applyBridgeAccountState(state: any) {
    if (!state || !state.ok || !state.account) return;
    const prevLogin = this.account.login;
    const prevServer = this.account.server;
    const prevBalance = this.account.balance;
    const prevEquity = this.account.equityUsd;
    const prevPnl = this.account.floatingPnlUsd;
    const prevConnected = this.account.isConnected;

    const nextAccount = this.normalizeAccount({
      ...this.account,
      ...state.account,
      isRealMt5Terminal: true,
      isConnected: true,
      connected: true,
      lastError: null,
    });

    const accountChanged =
      prevLogin !== nextAccount.login ||
      prevServer !== nextAccount.server ||
      prevBalance !== nextAccount.balance ||
      prevEquity !== nextAccount.equityUsd ||
      prevPnl !== nextAccount.floatingPnlUsd ||
      prevConnected !== nextAccount.isConnected;

    this.account = nextAccount;
    if (accountChanged) {
      this.saveAccount();
    }

    let ticketsChanged = false;
    if (Array.isArray(state.tickets)) {
      const mergedTickets = state.tickets.map((t: any) => this.normalizeTicket(t));

      if (mergedTickets.length !== this.tickets.length) {
        ticketsChanged = true;
      } else {
        for (let i = 0; i < mergedTickets.length; i++) {
          const a = mergedTickets[i];
          const b = this.tickets[i];
          if (
            a.ticket !== b.ticket ||
            a.status !== b.status ||
            a.entryPriceTicks !== b.entryPriceTicks ||
            a.slTicks !== b.slTicks ||
            a.tpTicks !== b.tpTicks ||
            a.profitUsd !== b.profitUsd ||
            a.lots !== b.lots
          ) {
            ticketsChanged = true;
            break;
          }
        }
      }

      if (ticketsChanged) {
        this.tickets = mergedTickets;
        this.saveTickets();
      }
    }

    if (accountChanged || ticketsChanged) {
      this.notify();
    }
  }

  async syncFromRealMt5(): Promise<{ ok: boolean; error?: string }> {
    const res = await this.callMt5Rpc({ action: 'status' });
    if (res && res.ok && res.account) {
      this.applyBridgeAccountState(res);
      return { ok: true };
    }
    const errMsg = res?.error || 'Không tìm thấy MetaTrader 5 đang mở trên máy.';
    this.account = {
      ...this.account,
      isRealMt5Terminal: false,
      lastError: errMsg,
    };
    this.notify();
    return { ok: false, error: errMsg };
  }

  async loginMt5Account(params: {
    login: string;
    password?: string;
    server: string;
    broker?: string;
  }): Promise<{ ok: boolean; error?: string }> {
    this.bridgeUnavailableUntilMs = 0;
    const res = await this.callMt5Rpc(
      {
        action: 'login',
        login: params.login,
        password: params.password || '',
        server: params.server,
      },
      { allowCliFallback: true, timeoutMs: 3000 }
    );
    if (res && res.ok && res.account) {
      this.applyBridgeAccountState(res);
      this.account.lastOrderFeedback = {
        ok: true,
        message: `Đã kết nối MT5 #${res.account.login} (${res.account.server}) · Số dư: $${Number(res.account.balance).toLocaleString()}`,
        timestamp: Date.now(),
      };
      this.notify();
      return { ok: true };
    }
    const errMsg = res?.error || 'Đăng nhập MT5 thất bại.';
    this.account = {
      ...this.account,
      lastError: errMsg,
      lastOrderFeedback: {
        ok: false,
        message: errMsg,
        timestamp: Date.now(),
      },
    };
    this.notify();
    return { ok: false, error: errMsg };
  }

  async fetchRealMt5Bars(
    instrumentId: string,
    timeframeUs: number,
    count: number = 1500,
    endMs?: number,
    deepTicks: boolean = false
  ): Promise<{
    ok: boolean;
    bars: BarDTO[];
    marketOpen: boolean;
    mt5Symbol?: string;
    lastTickTimeSec?: number;
    lastTickTimeMsc?: number;
  }> {
    this.bridgeUnavailableUntilMs = 0;
    const res = await this.callMt5Rpc(
      {
        action: 'bars',
        instrumentId,
        timeframeUs,
        count,
        ...(endMs && endMs > 0 ? { endMs } : {}),
        ...(deepTicks ? { deepTicks: true } : {}),
      },
      { allowCliFallback: true, timeoutMs: deepTicks ? 20000 : 12000 }
    );
    if (res && res.ok && Array.isArray(res.bars) && res.bars.length > 0) {
      this.account.marketOpen = Boolean(res.marketOpen);
      this.account.isRealMt5Terminal = true;
      this.notify();
      return {
        ok: true,
        bars: res.bars as BarDTO[],
        marketOpen: Boolean(res.marketOpen),
        mt5Symbol: res.mt5Symbol,
        lastTickTimeSec: res.lastTickTimeSec,
        lastTickTimeMsc: res.lastTickTimeMsc,
      };
    }
    return { ok: false, bars: [], marketOpen: false };
  }

  async pollRealMt5Tick(
    instrumentId: string,
    lastTimeMsc: number,
    timeframeUs: number = 60_000_000
  ): Promise<{
    ok: boolean;
    marketOpen: boolean;
    mt5Symbol?: string;
    lastTickTimeMsc: number;
    trades: TradeEventDTO[];
    orderBook: OrderBookSnapshotDTO | null;
    liveBar?: Partial<BarDTO> | null;
    prevClosedBar?: Partial<BarDTO> | null;
  }> {
    const res = await this.callMt5Rpc({
      action: 'poll_tick',
      instrumentId,
      lastTimeMsc,
      timeframeUs,
    });
    if (res && res.ok) {
      if (res.accountState && res.accountState.ok) {
        this.applyBridgeAccountState(res.accountState);
      }
      this.account.marketOpen = Boolean(res.marketOpen);
      return {
        ok: true,
        marketOpen: Boolean(res.marketOpen),
        mt5Symbol: res.mt5Symbol,
        lastTickTimeMsc: Number(res.lastTickTimeMsc || lastTimeMsc),
        trades: (res.trades || []) as TradeEventDTO[],
        orderBook: (res.orderBook || null) as OrderBookSnapshotDTO | null,
        liveBar: res.liveBar || null,
        prevClosedBar: res.prevClosedBar || null,
      };
    }
    return {
      ok: false,
      marketOpen: false,
      lastTickTimeMsc: lastTimeMsc,
      trades: [],
      orderBook: null,
      liveBar: null,
      prevClosedBar: null,
    };
  }

  updateAccount(patch: Partial<Mt5AccountConfig>) {
    this.updateAccountConfig(patch);
  }

  updateAccountConfig(patch: Partial<Mt5AccountConfig>) {
    this.account = this.normalizeAccount({ ...this.account, ...patch });
    this.saveAccount();
    this.notify();
  }

  connectLocalBridge() {
    this.syncFromRealMt5();
  }

  placeOrder(params: {
    instrumentId: string;
    side: 'Buy' | 'Sell';
    orderType: 'MARKET' | 'LIMIT' | 'STOP';
    lots: number;
    entryPriceTicks: number;
    slPriceTicks?: number | null;
    tpPriceTicks?: number | null;
    slTicks?: number | null;
    tpTicks?: number | null;
    comment?: string;
    linkedDrawingId?: string;
  }): Mt5OrderTicket {
    const inst = getInstrumentMeta(params.instrumentId);

    // ATAS Risk Manager Guard: Hard lockout if Daily Max Loss breached or Max Open Lots exceeded
    const riskStatus = this.getRiskStatus();
    if (riskStatus.isBreached) {
      this.account.lastOrderFeedback = {
        ok: false,
        message: `🛡 RISK LOCKOUT: ${riskStatus.reason}. Lệnh bị chặn để bảo vệ tài khoản.`,
        timestamp: Date.now(),
      };
      this.notify();
      return {
        ticket: 0,
        instrumentId: params.instrumentId,
        symbol: inst.symbol,
        side: params.side,
        orderType: params.orderType,
        status: 'CLOSED',
        isFilled: false,
        lots: 0,
        entryPriceTicks: Math.round(params.entryPriceTicks),
        slPriceTicks: null,
        tpPriceTicks: null,
        slTicks: null,
        tpTicks: null,
        openTimeUs: Date.now() * 1000,
        comment: 'RISK_LOCKOUT_REJECTED',
      };
    }

    const reqLots = Math.max(0.01, Number(params.lots.toFixed(2)));
    if (this.riskRules.isLockoutEnabled && riskStatus.openLots + reqLots > this.riskRules.maxOpenLots) {
      this.account.lastOrderFeedback = {
        ok: false,
        message: `🛡 RISK LIMIT: Tổng khối lượng (${(riskStatus.openLots + reqLots).toFixed(2)} Lot) vượt ngưỡng tối đa ${this.riskRules.maxOpenLots} Lot.`,
        timestamp: Date.now(),
      };
      this.notify();
      return {
        ticket: 0,
        instrumentId: params.instrumentId,
        symbol: inst.symbol,
        side: params.side,
        orderType: params.orderType,
        status: 'CLOSED',
        isFilled: false,
        lots: 0,
        entryPriceTicks: Math.round(params.entryPriceTicks),
        slPriceTicks: null,
        tpPriceTicks: null,
        slTicks: null,
        tpTicks: null,
        openTimeUs: Date.now() * 1000,
        comment: 'RISK_MAX_LOTS_REJECTED',
      };
    }
    const rawSl = params.slTicks ?? params.slPriceTicks ?? null;
    const rawTp = params.tpTicks ?? params.tpPriceTicks ?? null;
    const slRounded = rawSl ? Math.round(rawSl) : null;
    const tpRounded = rawTp ? Math.round(rawTp) : null;
    const isMarket = params.orderType === 'MARKET';
    const tempTicketNum = Math.floor(80000000 + Math.random() * 19999999);

    const optimisticTicket: Mt5OrderTicket = {
      ticket: tempTicketNum,
      instrumentId: params.instrumentId,
      symbol: inst.symbol,
      side: params.side,
      orderType: params.orderType,
      status: isMarket ? 'OPEN' : 'PENDING',
      isFilled: isMarket,
      lots: Math.max(0.01, Number(params.lots.toFixed(2))),
      entryPriceTicks: Math.round(params.entryPriceTicks),
      slPriceTicks: slRounded,
      tpPriceTicks: tpRounded,
      slTicks: slRounded,
      tpTicks: tpRounded,
      openTimeUs: Date.now() * 1000,
      comment: params.comment || `DeepChart ${params.orderType}`,
      linkedDrawingId: params.linkedDrawingId,
    };

    // Immediately show optimistic ticket on chart (0ms UI latency)
    this.tickets = [...this.tickets, optimisticTicket];
    this.saveTickets();
    this.notify();

    // Execute directly on the real MetaTrader 5 terminal
    this.callMt5Rpc({
      action: 'place_order',
      instrumentId: params.instrumentId,
      side: params.side,
      orderType: params.orderType,
      lots: optimisticTicket.lots,
      entryPriceTicks: optimisticTicket.entryPriceTicks,
      slPriceTicks: slRounded,
      tpPriceTicks: tpRounded,
      comment: optimisticTicket.comment,
    }).then((res) => {
      if (res && res.ok) {
        // Remove temporary optimistic ticket before applying real MT5 ticket state
        this.tickets = this.tickets.filter((t) => t.ticket !== tempTicketNum);
        if (res.accountState && res.accountState.ok) {
          this.applyBridgeAccountState(res.accountState);
        }
        this.account.lastOrderFeedback = {
          ok: true,
          message: `✅ Khớp lệnh MT5 #${res.order}: ${params.side.toUpperCase()} ${optimisticTicket.lots} Lot ${inst.symbol}`,
          timestamp: Date.now(),
        };
        this.notify();
      } else {
        const errText = res?.error || 'MT5 từ chối lệnh (Kiểm tra kết nối MetaTrader 5 hoặc giờ mở cửa thị trường)';
        this.tickets = this.tickets.filter((t) => t.ticket !== tempTicketNum);
        if (res?.accountState && res.accountState.ok) {
          this.applyBridgeAccountState(res.accountState);
        }
        this.account.lastOrderFeedback = {
          ok: false,
          message: `⚠️ ${errText}`,
          timestamp: Date.now(),
        };
        this.notify();
      }
    });

    return optimisticTicket;
  }

  modifyTicket(
    ticketId: number,
    patch: Partial<Pick<Mt5OrderTicket, 'entryPriceTicks' | 'slPriceTicks' | 'tpPriceTicks' | 'slTicks' | 'tpTicks' | 'lots'>>
  ) {
    const normalizedPatch: Partial<Mt5OrderTicket> = { ...patch };
    if (patch.slTicks !== undefined) normalizedPatch.slPriceTicks = patch.slTicks;
    if (patch.slPriceTicks !== undefined) normalizedPatch.slTicks = patch.slPriceTicks;
    if (patch.tpTicks !== undefined) normalizedPatch.tpPriceTicks = patch.tpTicks;
    if (patch.tpPriceTicks !== undefined) normalizedPatch.tpTicks = patch.tpPriceTicks;

    // Update optimistic state immediately for 60fps chart line dragging
    this.tickets = this.tickets.map((t) => {
      if (t.ticket !== ticketId) return t;
      return this.normalizeTicket({ ...t, ...normalizedPatch });
    });
    this.saveTickets();
    this.notify();

    // Send real Entry/SL/TP modification to MetaTrader 5
    this.callMt5Rpc({
      action: 'modify_order',
      ticket: ticketId,
      entryPriceTicks: normalizedPatch.entryPriceTicks,
      slPriceTicks: normalizedPatch.slTicks ?? normalizedPatch.slPriceTicks,
      tpPriceTicks: normalizedPatch.tpTicks ?? normalizedPatch.tpPriceTicks,
    }).then((res) => {
      if (res?.accountState && res.accountState.ok) {
        this.applyBridgeAccountState(res.accountState);
      }
    });
  }

  setTicketBreakeven(ticketId: number) {
    const tk = this.tickets.find((t) => t.ticket === ticketId);
    if (!tk) return;
    this.modifyTicket(ticketId, {
      slTicks: tk.entryPriceTicks,
      slPriceTicks: tk.entryPriceTicks,
    });
    this.account.lastOrderFeedback = {
      ok: true,
      message: `🛡 Đã dời SL về Hòa Vốn (Breakeven) cho Ticket #${ticketId}`,
      timestamp: Date.now(),
    };
    this.notify();
  }

  breakevenAll(instrumentId: string) {
    const open = this.getTickets(instrumentId).filter((t) => t.status === 'OPEN');
    open.forEach((tk) => {
      this.modifyTicket(tk.ticket, {
        slTicks: tk.entryPriceTicks,
        slPriceTicks: tk.entryPriceTicks,
      });
    });
    if (open.length > 0) {
      this.account.lastOrderFeedback = {
        ok: true,
        message: `🛡 Đã dời SL Hòa Vốn (BE) cho ${open.length} vị thế đang mở`,
        timestamp: Date.now(),
      };
      this.notify();
    }
  }

  reverseAll(instrumentId: string, currentPriceTicks: number) {
    const open = this.getTickets(instrumentId).filter((t) => t.status === 'OPEN');
    if (open.length === 0) return;
    const netLots = open.reduce((sum, t) => sum + (t.side === 'Buy' ? t.lots : -t.lots), 0);
    this.flattenAll(instrumentId, currentPriceTicks);
    if (Math.abs(netLots) >= 0.01) {
      const reverseSide: 'Buy' | 'Sell' = netLots > 0 ? 'Sell' : 'Buy';
      this.placeOrder({
        instrumentId,
        side: reverseSide,
        orderType: 'MARKET',
        lots: Math.abs(Number(netLots.toFixed(2))),
        entryPriceTicks: currentPriceTicks,
        comment: 'DeepChart Reverse',
      });
    }
  }

  onLivePriceTick(instrumentId: string, currentPriceTicks: number) {
    if (!currentPriceTicks || currentPriceTicks <= 0) return;
    if (this.account.isRealMt5Terminal) return;

    let openFloatingPnl = 0;
    for (const t of this.tickets) {
      if (t.instrumentId === instrumentId && t.isFilled) {
        openFloatingPnl += computePositionPnlUsd(t.side, t.entryPriceTicks, currentPriceTicks, t.lots, t.instrumentId);
      }
    }
    this.account.equityUsd = Number((this.account.balance + openFloatingPnl).toFixed(2));
  }

  closeTicket(ticketId: number, _currentPriceTicks?: number) {
    // Optimistic removal
    this.tickets = this.tickets.filter((t) => t.ticket !== ticketId);
    this.saveTickets();
    this.notify();

    this.callMt5Rpc({
      action: 'close_order',
      ticket: ticketId,
    }).then((res) => {
      if (res?.accountState && res.accountState.ok) {
        this.applyBridgeAccountState(res.accountState);
      }
      if (res && !res.ok && res.error) {
        this.account.lastOrderFeedback = {
          ok: false,
          message: `⚠️ ${res.error}`,
          timestamp: Date.now(),
        };
        this.notify();
      } else if (res && res.ok) {
        this.account.lastOrderFeedback = {
          ok: true,
          message: `✅ Đã đóng Ticket MT5 #${ticketId}`,
          timestamp: Date.now(),
        };
        this.notify();
      }
    });
  }

  flattenAll(instrumentId: string, _currentPriceTicks: number) {
    // Also clear local SIM open positions for this symbol
    this.tickets = this.tickets.filter(
      (t) => !(this.isSameInstrumentOrBase(t.instrumentId, instrumentId) && t.status === 'OPEN')
    );
    this.saveTickets();
    this.notify();

    this.callMt5Rpc({
      action: 'flatten_all',
      instrumentId,
    }).then((res) => {
      if (res?.accountState && res.accountState.ok) {
        this.applyBridgeAccountState(res.accountState);
      }
      this.account.lastOrderFeedback = {
        ok: true,
        message: `✅ Đã đóng toàn bộ vị thế đang mở`,
        timestamp: Date.now(),
      };
      this.notify();
    });
  }

  cancelPending(instrumentId: string) {
    // Also clear local SIM pending orders for this symbol
    this.tickets = this.tickets.filter(
      (t) => !(this.isSameInstrumentOrBase(t.instrumentId, instrumentId) && t.status === 'PENDING')
    );
    this.saveTickets();
    this.notify();

    this.callMt5Rpc({
      action: 'cancel_pending',
      instrumentId,
    }).then((res) => {
      if (res?.accountState && res.accountState.ok) {
        this.applyBridgeAccountState(res.accountState);
      }
      this.account.lastOrderFeedback = {
        ok: true,
        message: `✅ Đã hủy toàn bộ lệnh chờ`,
        timestamp: Date.now(),
      };
      this.notify();
    });
  }

  exportPythonMt5BridgeScript(): string {
    return `# DeepChart Real MT5 Bridge is already integrated at scripts/mt5_live_bridge.py
# Run: python scripts/mt5_live_bridge.py --serve
`;
  }
}

export const mt5BridgeService = new Mt5BridgeService();
