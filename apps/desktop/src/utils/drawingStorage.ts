//! Persistent Local Storage for Chart Drawings & Technical Annotations
//! Isolates user drawings by instrument_id so switching assets preserves drawings.

import { ChartDrawing } from '../types/drawings';

const STORAGE_PREFIX = 'deepchart_drawings_v1_';

export function loadDrawings(instrumentId: string): ChartDrawing[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${instrumentId}`);
    if (raw) {
      return JSON.parse(raw) as ChartDrawing[];
    }
  } catch (e) {
    console.warn(`Failed to load drawings for ${instrumentId}:`, e);
  }
  return [];
}

export function saveDrawings(instrumentId: string, drawings: ChartDrawing[]): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${instrumentId}`, JSON.stringify(drawings));
  } catch (e) {
    console.warn(`Failed to save drawings for ${instrumentId}:`, e);
  }
}

export function clearDrawings(instrumentId: string): void {
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${instrumentId}`);
  } catch (e) {
    console.warn(`Failed to clear drawings for ${instrumentId}:`, e);
  }
}
