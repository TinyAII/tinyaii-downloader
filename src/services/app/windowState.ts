import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import type { Window } from '@tauri-apps/api/window';

const WINDOW_STATE_KEY_PREFIX = 'tinyaii-window-state';
const MIN_WINDOW_WIDTH = 640;
const MIN_WINDOW_HEIGHT = 420;

type PersistedWindowState = {
  width: number;
  height: number;
  x: number;
  y: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseWindowState(raw: string | null): PersistedWindowState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      !isFiniteNumber(parsed.width) ||
      !isFiniteNumber(parsed.height) ||
      !isFiniteNumber(parsed.x) ||
      !isFiniteNumber(parsed.y)
    ) {
      return null;
    }
    if (parsed.width <= 0 || parsed.height <= 0) {
      return null;
    }
    return {
      width: parsed.width,
      height: parsed.height,
      x: parsed.x,
      y: parsed.y,
    };
  } catch {
    return null;
  }
}

function keyForWindow(windowLabel: string) {
  return `${WINDOW_STATE_KEY_PREFIX}:${windowLabel}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function normalizeWindowState(state: PersistedWindowState) {
  const screenWidth = window.screen.availWidth;
  const screenHeight = window.screen.availHeight;
  const width = clamp(state.width, MIN_WINDOW_WIDTH, screenWidth);
  const height = clamp(state.height, MIN_WINDOW_HEIGHT, screenHeight);
  const maxX = Math.max(0, screenWidth - width);
  const maxY = Math.max(0, screenHeight - height);
  return {
    width,
    height,
    x: clamp(state.x, 0, maxX),
    y: clamp(state.y, 0, maxY),
  };
}

export function readWindowState(windowLabel: string) {
  return parseWindowState(localStorage.getItem(keyForWindow(windowLabel)));
}

export function writeWindowState(windowLabel: string, state: PersistedWindowState) {
  localStorage.setItem(keyForWindow(windowLabel), JSON.stringify(state));
}

export async function captureWindowState(appWindow: Window) {
  const [size, position] = await Promise.all([appWindow.innerSize(), appWindow.outerPosition()]);
  writeWindowState(appWindow.label, {
    width: size.width,
    height: size.height,
    x: position.x,
    y: position.y,
  });
}

export async function restoreWindowState(appWindow: Window) {
  const state = readWindowState(appWindow.label);
  if (!state) return;
  const normalized = normalizeWindowState(state);
  await appWindow.setSize(new LogicalSize(normalized.width, normalized.height));
  await appWindow.setPosition(new LogicalPosition(normalized.x, normalized.y));
}
