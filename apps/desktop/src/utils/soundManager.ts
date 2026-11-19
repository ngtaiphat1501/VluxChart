//! DeepChart Real-Time Order Flow Sound Synthesizer Engine (P4.6)
//! Uses Web Audio API to produce zero-dependency, low-latency acoustic cues
//! for Whales, Icebergs, Stacked Imbalances, and Divergence alerts.

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export class SoundManager {
  private static enabled: boolean = true;

  public static isEnabled(): boolean {
    return this.enabled;
  }

  public static setEnabled(val: boolean): void {
    this.enabled = val;
    try {
      localStorage.setItem('deepchart_sound_enabled', val ? 'true' : 'false');
    } catch {}
  }

  public static initFromStorage(): void {
    try {
      const saved = localStorage.getItem('deepchart_sound_enabled');
      if (saved !== null) {
        this.enabled = saved === 'true';
      }
    } catch {}
  }

  /// Low resonant gong tone (Whale Trade)
  public static playWhaleChime(): void {
    if (!this.enabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.6);

      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    } catch {}
  }

  /// High-frequency sonar ping (Iceberg Liquidity Replenishment)
  public static playIcebergPing(): void {
    if (!this.enabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.25);

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch {}
  }

  /// Multi-tone chord sweep (Stacked Imbalance)
  public static playStackSwoosh(): void {
    if (!this.enabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    try {
      [440, 554.37, 659.25].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.05);

        gain.gain.setValueAtTime(0.12, ctx.currentTime + idx * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + idx * 0.05);
        osc.stop(ctx.currentTime + 0.4);
      });
    } catch {}
  }

  /// Two-tone oscillating warning (CVD Divergence / Bull Trap)
  public static playDivergenceWarning(): void {
    if (!this.enabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(330, ctx.currentTime);
      osc.frequency.setValueAtTime(495, ctx.currentTime + 0.15);

      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch {}
  }
}
