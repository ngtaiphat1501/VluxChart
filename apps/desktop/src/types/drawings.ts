//! DeepChart Interactive Drawing & Annotation Types (Phase P8 / VIS-008)
//! Full TradingView-grade interactive drawing suite (trendlines, horizontal lines/rays, arrows,
//! order block rectangles, fibonacci, long/short R:R positions, ruler/price-range, brush, SMC/ICT labels).

export type DrawingTool =
  | 'cursor'
  | 'horizontal_line'
  | 'horizontal_ray'
  | 'trendline'
  | 'arrow'
  | 'imbalance_box'
  | 'fibonacci'
  | 'long_position'
  | 'short_position'
  | 'price_range'
  | 'brush'
  | 'text_note';

export interface DrawingPoint {
  time_us: number;
  price_ticks: number;
}

export interface ChartDrawing {
  id: string;
  type: DrawingTool;
  instrument_id: string;
  /**
   * - 1-point tools (horizontal_line, horizontal_ray, text_note):
   *     points[0] = anchor { time_us, price_ticks }
   * - 2-point tools (trendline, arrow, imbalance_box, fibonacci, price_range):
   *     points[0] = start { time_us, price_ticks }
   *     points[1] = end   { time_us, price_ticks }
   * - 3-point tools (long_position, short_position):
   *     points[0] = Entry start { time_us, price_ticks (Entry Price) }
   *     points[1] = Box end & Target { time_us (End Time), price_ticks (Take Profit Price) }
   *     points[2] = Stop Loss { time_us (End Time), price_ticks (Stop Loss Price) }
   * - Multi-point tools (brush):
   *     points = array of freehand path coordinates
   */
  points: DrawingPoint[];
  color: string;
  lineWidth: number;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  fillColor?: string;
  text?: string;
  lotSize?: number;
  extendRight?: boolean;
  isLocked?: boolean;
}

export const FIBONACCI_LEVELS = [
  { ratio: 0.0, label: '0', color: '#94A3B8' },
  { ratio: 0.236, label: '0.236', color: '#F87171' },
  { ratio: 0.382, label: '0.382', color: '#FBBF24' },
  { ratio: 0.5, label: '0.5', color: '#4ADE80' },
  { ratio: 0.618, label: '0.618', color: '#2DD4BF' },
  { ratio: 0.786, label: '0.786', color: '#38BDF8' },
  { ratio: 1.0, label: '1', color: '#A855F7' },
];
