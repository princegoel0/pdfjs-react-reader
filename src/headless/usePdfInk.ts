import { useCallback, useMemo, useState } from 'react';
import type { InkSettings, InkStroke, PdfPoint } from '../lib/ink';
import { createStrokeId } from '../lib/ink';

export interface UsePdfInkOptions {
  /** Changing this (e.g. a new document) discards the drawing. */
  resetKey?: unknown;
}

export interface UsePdfInkResult {
  /** Committed strokes, in document order. */
  strokes: InkStroke[];
  settings: InkSettings;
  /** True while the freehand tool is armed. */
  drawing: boolean;
  setDrawing: (on: boolean) => void;
  updateSettings: (patch: Partial<InkSettings>) => void;
  /** Commits a finished stroke; points are in PDF user space. */
  addStroke: (pageIndex: number, points: PdfPoint[]) => void;
  undo: () => void;
  clear: () => void;
  strokesForPage: (pageIndex: number) => InkStroke[];
  getDrawingData: () => InkStroke[];
  setDrawingData: (strokes: InkStroke[]) => void;
}

const DEFAULT_SETTINGS: InkSettings = { color: '#d92d20', width: 2 };

// Shared empty list so pages without strokes keep a stable `inkStrokes` prop.
const NO_STROKES: InkStroke[] = [];

export function usePdfInk(options: UsePdfInkOptions = {}): UsePdfInkResult {
  const { resetKey = null } = options;
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  const [settings, setSettings] = useState<InkSettings>(DEFAULT_SETTINGS);
  const [drawing, setDrawing] = useState(false);
  const [lastResetKey, setLastResetKey] = useState<unknown>(resetKey);

  // A new document invalidates any drawing.
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    setStrokes([]);
    setDrawing(false);
  }

  const updateSettings = useCallback((patch: Partial<InkSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const addStroke = useCallback(
    (pageIndex: number, points: PdfPoint[]) => {
      if (points.length === 0) return;
      setStrokes((prev) => [
        ...prev,
        { id: createStrokeId(), pageIndex, points, color: settings.color, width: settings.width },
      ]);
    },
    [settings],
  );

  const undo = useCallback(() => setStrokes((prev) => prev.slice(0, -1)), []);
  const clear = useCallback(() => setStrokes([]), []);

  const byPage = useMemo(() => {
    const map = new Map<number, InkStroke[]>();
    for (const stroke of strokes) {
      const list = map.get(stroke.pageIndex);
      if (list) list.push(stroke);
      else map.set(stroke.pageIndex, [stroke]);
    }
    return map;
  }, [strokes]);

  const strokesForPage = useCallback(
    (pageIndex: number) => byPage.get(pageIndex) ?? NO_STROKES,
    [byPage],
  );

  return {
    strokes,
    settings,
    drawing,
    setDrawing,
    updateSettings,
    addStroke,
    undo,
    clear,
    strokesForPage,
    getDrawingData: () => strokes,
    setDrawingData: (next: InkStroke[]) => setStrokes(next),
  };
}
