import React, { useState } from 'react';
import { ChartSnapshotDTO } from '../types';

interface AiConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  snapshot: ChartSnapshotDTO;
}

export const AiConnectModal: React.FC<AiConnectModalProps> = ({
  isOpen,
  onClose,
  snapshot,
}) => {
  const [provider, setProvider] = useState<'builtin' | 'antigravity' | 'gemini' | 'openai'>('builtin');
  const [apiKey, setApiKey] = useState<string>('');
  const [webhookUrl, setWebhookUrl] = useState<string>('http://127.0.0.1:8080/v1/agent');
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [agentLogs, setAgentLogs] = useState<string[]>([
    '[AI AGENT CONNECTED] Built-in Rust Quantitative Narrative Engine active.',
    '[ORDER FLOW] Streaming multi-venue footprint & delta divergence signals.',
  ]);

  if (!isOpen) return null;

  const narrative = snapshot.market_narrative;

  const handleAskAgent = (promptText: string) => {
    const q = promptText || customPrompt;
    if (!q) return;

    setAgentLogs((prev) => [
      ...prev,
      `[PROMPT] ${q}`,
      `[AGENT REASONING] Phân tích theo chuẩn định chế: ${narrative?.headline || 'Thị trường đang tích lũy cân bằng.'}`,
      `[INSTITUTIONAL BIAS] ${narrative?.institutional_bias || 'Chưa phát hiện gom xả đột biến.'}`,
      `[RISK ALERT] ${narrative?.risk_alert || 'Duy trì quản trị vốn thận trọng.'}`,
    ]);
    setCustomPrompt('');
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(5, 7, 12, 0.88)',
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
          width: '900px',
          maxWidth: '95vw',
          height: '700px',
          maxHeight: '90vh',
          background: '#0F121A',
          border: '1px solid #232938',
          borderRadius: '6px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.75)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div
          style={{
            height: '42px',
            background: '#161922',
            borderBottom: '1px solid #232938',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 800, color: '#F1F5F9', letterSpacing: '0.4px' }}>
              AI CONNECT — TRẠM ĐIỀU HÀNH AI AGENT ĐỊNH CHẾ
            </span>
            <span
              style={{
                background: '#1E2330',
                color: '#34D399',
                border: '1px solid #2D3548',
                fontSize: '9px',
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: '3px',
                fontFamily: 'monospace',
              }}
            >
              ATAS COMPLIANT
            </span>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#64748B',
              cursor: 'pointer',
              fontSize: '13px',
              padding: '2px 6px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '14px 18px', gap: '12px', overflowY: 'auto' }}>
          {/* SECTION 1: LIVE MARKET NARRATIVE FROM RUST ENGINE */}
          <div
            style={{
              background: '#141720',
              border: '1px solid #232938',
              borderRadius: '4px',
              padding: '10px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#38BDF8' }}>
                BÌNH LUẬN DÒNG LỆNH THỜI GIAN THỰC (RUST ENGINE NARRATOR)
              </span>
              <span style={{ fontSize: '9.5px', color: '#10B981', fontWeight: 700 }}>● ĐANG ĐỌC TỪNG TICK</span>
            </div>

            <div style={{ fontSize: '11px', fontWeight: 700, color: '#F1F5F9', lineHeight: 1.4 }}>
              {narrative?.headline || 'Thị trường đang tích lũy cân bằng trong biên độ hẹp.'}
            </div>

            <div style={{ fontSize: '10px', color: '#94A3B8', lineHeight: 1.5 }}>
              {narrative?.order_flow_summary || 'Dòng lệnh mua bán hai chiều cân bằng, chưa có phe nào bứt phá rõ rệt.'}
            </div>

            {narrative?.risk_alert && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.09)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#FCA5A5',
                  padding: '4px 8px',
                  borderRadius: '3px',
                  fontSize: '9.5px',
                  fontWeight: 600,
                  marginTop: '2px',
                }}
              >
                {narrative.risk_alert}
              </div>
            )}
          </div>

          {/* SECTION 2: CONNECT EXTERNAL AI AGENT */}
          <div
            style={{
              background: '#141720',
              border: '1px solid #232938',
              borderRadius: '4px',
              padding: '10px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 800, color: '#CBD5E1' }}>
              CẤU HÌNH KẾT NỐI AI AGENT (AI CONNECT PROVIDER)
            </div>

            <div style={{ display: 'flex', gap: '6px' }}>
              {[
                { id: 'builtin' as const, label: 'DeepChart Built-In (Rust 0ms)' },
                { id: 'antigravity' as const, label: 'Google Antigravity Agent' },
                { id: 'gemini' as const, label: 'Gemini 1.5 Pro' },
                { id: 'openai' as const, label: 'OpenAI GPT-4o' },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => setProvider(p.id)}
                  style={{
                    background: provider === p.id ? '#262D3D' : '#1A1E29',
                    color: provider === p.id ? '#FFFFFF' : '#8E9BAE',
                    border: `1px solid ${provider === p.id ? '#38BDF8' : '#232938'}`,
                    borderRadius: '3px',
                    padding: '4px 8px',
                    fontSize: '9.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {provider !== 'builtin' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '9px', color: '#64748B', display: 'block', marginBottom: '2px' }}>
                    API KEY / TOKEN
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Nhập API Key của bạn..."
                    style={{
                      width: '100%',
                      background: '#0D0F16',
                      border: '1px solid #282E3E',
                      borderRadius: '3px',
                      padding: '4px 8px',
                      color: '#F8FAFC',
                      fontSize: '10px',
                      fontFamily: 'monospace',
                      outline: 'none',
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '9px', color: '#64748B', display: 'block', marginBottom: '2px' }}>
                    AGENT WEBHOOK / ENDPOINT
                  </label>
                  <input
                    type="text"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    style={{
                      width: '100%',
                      background: '#0D0F16',
                      border: '1px solid #282E3E',
                      borderRadius: '3px',
                      padding: '4px 8px',
                      color: '#F8FAFC',
                      fontSize: '10px',
                      fontFamily: 'monospace',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* SECTION 3: QUICK PROMPTS & INTERACTIVE CHAT */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {[
                'Phân tích cụm hấp thụ đỉnh/đáy',
                'Kiểm tra Call Wall & Put Wall Deribit',
                'Tính Expected Move hôm nay',
                'Quét bẫy Stop Run gần nhất',
              ].map((qp) => (
                <button
                  key={qp}
                  onClick={() => handleAskAgent(qp)}
                  style={{
                    background: '#1E2330',
                    color: '#94A3B8',
                    border: '1px solid #2D3548',
                    borderRadius: '3px',
                    padding: '3px 8px',
                    fontSize: '9.5px',
                    cursor: 'pointer',
                  }}
                >
                  ⚡ {qp}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAskAgent(customPrompt)}
                placeholder="Hỏi AI Agent về cấu trúc thị trường, tín hiệu vào lệnh..."
                style={{
                  flex: 1,
                  background: '#12151D',
                  border: '1px solid #262D3D',
                  borderRadius: '3px',
                  padding: '6px 10px',
                  color: '#F8FAFC',
                  fontSize: '11px',
                  outline: 'none',
                }}
              />
              <button
                onClick={() => handleAskAgent(customPrompt)}
                style={{
                  background: '#38BDF8',
                  color: '#0B0D12',
                  border: 'none',
                  borderRadius: '3px',
                  padding: '6px 16px',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Gửi Agent
              </button>
            </div>
          </div>

          {/* Console Stream Output */}
          <div
            style={{
              flex: 1,
              background: '#0B0D12',
              border: '1px solid #1E2330',
              borderRadius: '4px',
              padding: '8px 12px',
              fontFamily: 'monospace',
              fontSize: '10px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            {agentLogs.map((log, idx) => (
              <div
                key={idx}
                style={{
                  color: log.startsWith('[PROMPT]')
                    ? '#38BDF8'
                    : log.startsWith('[AGENT')
                    ? '#F8FAFC'
                    : log.startsWith('[RISK')
                    ? '#F87171'
                    : '#94A3B8',
                }}
              >
                {log}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
