import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'fs';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { SessionState, Shipment, AuditEntry } from '../types/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../../data');
const STATE_FILE = join(DATA_DIR, 'session-state.json');

function emptyState(): SessionState {
  return {
    trips: {},
    shipments: {},
    containers: {},
    waybills: {},
    printJobs: [],
    audit: [],
    reviewQueue: {},
    demoFlags: { printerError: false, sourceDown: false },
  };
}

let state: SessionState = emptyState();
let autosave: { path: string; checkpoint: string } | undefined;

export function getState(): SessionState {
  return state;
}

export function setState(next: SessionState) {
  state = next;
}

export function loadShipmentsFromDisk(): Shipment[] {
  const demoPath = join(DATA_DIR, 'shipments_demo.json');
  const fullPath = join(DATA_DIR, 'shipments_full.json');
  const path = existsSync(demoPath) ? demoPath : fullPath;
  if (!existsSync(path)) {
    console.warn('[store] No shipments JSON found at', path);
    return [];
  }
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Shipment[];
  return raw;
}

export function initSession(usePreAssignment = true) {
  const list = loadShipmentsFromDisk();
  const shipments: Record<string, Shipment> = {};
  for (const s of list) {
    shipments[s.barcode] = { ...s, status: s.status || 'pending' };
  }
  state = {
    ...emptyState(),
    shipments,
  };
  if (usePreAssignment) {
    // pre-assignment will be called from AssignmentService
  }
  console.log(`[store] Loaded ${Object.keys(shipments).length} shipments`);
  return state;
}

export function persistSession(path = autosave?.path ?? STATE_FILE) {
  const next = JSON.stringify(state);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temporary, next, { encoding: 'utf-8', flag: 'wx', flush: true });
    renameSync(temporary, path);
    if (autosave?.path === path) autosave.checkpoint = next;
  } catch (cause) {
    try {
      rmSync(temporary, { force: true });
    } catch (error) {
      console.error('[store] Temporary snapshot cleanup failed', error);
    }
    if (autosave?.path === path) state = JSON.parse(autosave.checkpoint) as SessionState;
    console.error('[store] Session save failed', cause);
    throw Object.assign(new Error('Не удалось сохранить рабочую сессию. Повторите операцию.', { cause }), {
      statusCode: 503,
      code: 'SESSION_SAVE_FAILED',
    });
  }
}

export function enableSessionAutosave(path = STATE_FILE) {
  autosave = { path, checkpoint: JSON.stringify(state) };
}

export function saveSessionChange() {
  if (autosave) persistSession(autosave.path);
}

export function restoreSession(path = autosave?.path ?? STATE_FILE): boolean {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }

  const restored = JSON.parse(contents) as SessionState;
  const record = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value);
  if (!record(restored) || !record(restored.shipments) || !record(restored.containers) ||
    !record(restored.waybills) || !Array.isArray(restored.printJobs) ||
    !Array.isArray(restored.audit) || !record(restored.demoFlags)) {
    throw new Error(`Некорректный снимок рабочей сессии: ${path}`);
  }
  state = { ...restored, reviewQueue: restored.reviewQueue ?? {}, trips: restored.trips ?? {} };
  if (autosave?.path === path) autosave.checkpoint = JSON.stringify(state);
  console.log('[store] Session restored');
  return true;
}

export function addAudit(entry: Omit<AuditEntry, 'id' | 'at' | 'userId'>) {
  const full: AuditEntry = {
    ...entry,
    id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    userId: 'operator',
  };
  state.audit.unshift(full);
  if (state.audit.length > 500) state.audit.length = 500;
  return full;
}
