import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { SessionState, Shipment, Container, Waybill, PrintJob, AuditEntry } from '../types/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../../data');
const STATE_FILE = join(DATA_DIR, 'session-state.json');

function emptyState(): SessionState {
  return {
    shipments: {},
    containers: {},
    waybills: {},
    printJobs: [],
    audit: [],
    demoFlags: { printerError: false, sourceDown: false },
  };
}

let state: SessionState = emptyState();

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

export function persistSession() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (e) {
    console.error('[store] persist failed', e);
  }
}

export function restoreSession(): boolean {
  if (!existsSync(STATE_FILE)) return false;
  try {
    state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    console.log('[store] Session restored');
    return true;
  } catch {
    return false;
  }
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
