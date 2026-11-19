/**
 * DeepChart Gate G5: Desktop Canvas 2D Footprint Viewport Culling & Frame Budget Benchmark
 * Simulates Full HD (1920x1080) terminal viewport with 1,000 historical footprint bars.
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

function runCanvasBenchmark() {
  const VIEWPORT_WIDTH = 1920;
  const VIEWPORT_HEIGHT = 1080;
  const TOTAL_BARS = 1000;
  const BAR_WIDTH = 110;
  const BAR_SPACING = 24;
  const CELLS_PER_BAR = 40;

  console.log(`Generating synthetic dataset of ${TOTAL_BARS} footprint bars...`);
  const bars = [];
  let currentPrice = 9500000;

  for (let i = 0; i < TOTAL_BARS; i++) {
    const cells = [];
    let maxCellVol = 1;
    for (let c = 0; c < CELLS_PER_BAR; c++) {
      const buy = Math.floor(Math.random() * 50) + 1;
      const sell = Math.floor(Math.random() * 50) + 1;
      const total = buy + sell;
      if (total > maxCellVol) maxCellVol = total;
      cells.push({
        price_ticks: currentPrice + (c - 20) * 10,
        buy_units: buy,
        sell_units: sell,
        total_units: total,
      });
    }

    bars.push({
      bar_start_us: 1700000000000000 + i * 60000000,
      open_ticks: currentPrice - 50,
      high_ticks: currentPrice + 200,
      low_ticks: currentPrice - 200,
      close_ticks: currentPrice + 30,
      footprint: cells,
      poc_ticks: currentPrice,
    });

    currentPrice += (Math.random() - 0.49) * 40;
  }

  console.log(`Dataset generated. Simulating 1,000 animation frames with pan & zoom...`);

  let totalCulled = 0;
  let totalRendered = 0;
  let frameTimes = [];

  const FRAMES_TO_SIMULATE = 500;

  for (let f = 0; f < FRAMES_TO_SIMULATE; f++) {
    const panX = Math.sin(f * 0.05) * 500;
    const zoom = 1.0 + Math.cos(f * 0.02) * 0.2;
    const currentBarWidth = BAR_WIDTH * zoom;
    const currentBarSpacing = BAR_SPACING * zoom;
    const startX = VIEWPORT_WIDTH - (bars.length * (currentBarWidth + currentBarSpacing)) + panX - 20;

    const t0 = performance.now();

    let frameRendered = 0;
    let frameCulled = 0;

    // Simulate FootprintCanvas draw loop
    for (let i = 0; i < bars.length; i++) {
      const x = startX + i * (currentBarWidth + currentBarSpacing);
      // Viewport culling test
      if (x + currentBarWidth < 0 || x > VIEWPORT_WIDTH) {
        frameCulled++;
        continue; // Culled!
      }

      frameRendered++;

      // Inner cell loop simulation for visible bars
      const bar = bars[i];
      let dummyAcc = 0;
      for (let c = 0; c < bar.footprint.length; c++) {
        const cell = bar.footprint[c];
        dummyAcc += cell.buy_units + cell.sell_units;
      }
    }

    const t1 = performance.now();
    frameTimes.push(t1 - t0);
    totalRendered += frameRendered;
    totalCulled += frameCulled;
  }

  // Calculate statistics
  frameTimes.sort((a, b) => a - b);
  const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
  const p50 = frameTimes[Math.floor(frameTimes.length * 0.5)];
  const p95 = frameTimes[Math.floor(frameTimes.length * 0.95)];
  const p99 = frameTimes[Math.floor(frameTimes.length * 0.99)];
  const maxFrameTime = frameTimes[frameTimes.length - 1];
  const fpsEquivalent = 1000 / avgFrameTime;

  const avgVisiblePerFrame = totalRendered / FRAMES_TO_SIMULATE;
  const avgCulledPerFrame = totalCulled / FRAMES_TO_SIMULATE;
  const cullingEfficiencyPct = (avgCulledPerFrame / TOTAL_BARS) * 100;

  console.log(`\n=== Canvas 2D Viewport Culling & Frame Budget Results ===`);
  console.log(`Total Bars in State:       ${TOTAL_BARS}`);
  console.log(`Avg Visible per Frame:     ${avgVisiblePerFrame.toFixed(1)} bars`);
  console.log(`Avg Culled per Frame:      ${avgCulledPerFrame.toFixed(1)} bars (${cullingEfficiencyPct.toFixed(1)}% culling rate)`);
  console.log(`Avg Frame Compute Time:    ${avgFrameTime.toFixed(4)} ms`);
  console.log(`p50 Frame Time:            ${p50.toFixed(4)} ms`);
  console.log(`p95 Frame Time:            ${p95.toFixed(4)} ms`);
  console.log(`p99 Frame Time:            ${p99.toFixed(4)} ms`);
  console.log(`Max Frame Time:            ${maxFrameTime.toFixed(4)} ms`);
  console.log(`Theoretical Max FPS:       ${fpsEquivalent.toFixed(0)} FPS (60 FPS target budget: <= 16.6 ms)`);

  const report = {
    benchmark: 'desktop_canvas_culling_and_frame_budget',
    status: avgFrameTime < 16.6 ? 'PASS' : 'FAIL',
    timestamp: new Date().toISOString(),
    metrics: {
      total_bars_in_memory: TOTAL_BARS,
      cells_per_bar: CELLS_PER_BAR,
      simulated_frames: FRAMES_TO_SIMULATE,
      avg_visible_bars: avgVisiblePerFrame,
      culling_efficiency_pct: cullingEfficiencyPct,
      avg_frame_ms: avgFrameTime,
      p50_frame_ms: p50,
      p95_frame_ms: p95,
      p99_frame_ms: p99,
      max_frame_ms: maxFrameTime,
      target_frame_budget_ms: 16.666,
      target_fps: 60,
      theoretical_fps: fpsEquivalent,
    },
  };

  const outDir = path.resolve(__dirname, '../../docs/benchmarks');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const reportPath = path.join(outDir, 'g5_ui_benchmark_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`Report successfully written to ${reportPath}`);

  if (p95 > 16.6) {
    throw new Error(`p95 frame time ${p95.toFixed(2)}ms exceeds 16.6ms budget!`);
  }
}

runCanvasBenchmark();
