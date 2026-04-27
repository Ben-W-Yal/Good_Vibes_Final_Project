type SpaceMouseMotion = {
  tx: number;
  ty: number;
  tz: number;
  rx: number;
  ry: number;
  rz: number;
};

type SpaceMouseStatus = {
  supported: boolean;
  connected: boolean;
  label: string;
};

type SpaceMouseDebug = {
  reportCount: number;
  lastReportId: number;
  lastReportBytes: number;
  lastReportAt: number;
  connectedVendorId: number;
  connectedProductId: number;
  connectedProductName: string;
  inputSource: "none" | "webhid" | "bridge";
  txRaw: number;
  tyRaw: number;
  tzRaw: number;
  rxRaw: number;
  ryRaw: number;
  rzRaw: number;
};

export type SpaceMouseControlConfig = {
  moveSpeed: number;
  lateralBoost: number;
  rotateSpeed: number;
  tiltEffect: number;
  invertTilt: boolean;
  cameraMode: "cinematic" | "helicopter";
};

const SPACEMOUSE_VENDOR_IDS = [
  0x256f, // 3Dconnexion
];
const SPACEMOUSE_USAGE_PAGE = 0x01; // Generic Desktop Controls
const SPACEMOUSE_USAGE = 0x08; // Multi-axis Controller
// 3Dconnexion products typically use ~±350; some firmware/units go higher — 500 covers Pro/Cadman-style ranges.
const AXIS_MAX = 500;
const DEADZONE = 0.06;
const BRIDGE_DEADZONE = 0.12;
const BRIDGE_CONNECT_TIMEOUT_MS = 1200;
const CONTROL_CONFIG_STORAGE_KEY = "spacemouse-control-config";
const DEFAULT_CONTROL_CONFIG: SpaceMouseControlConfig = {
  moveSpeed: 1,
  lateralBoost: 1.8,
  rotateSpeed: 1,
  tiltEffect: 1,
  invertTilt: false,
  cameraMode: "helicopter",
};

type HidInputReportEventLike = {
  reportId: number;
  data: DataView;
};

type HidCollectionLike = {
  usagePage?: number;
  usage?: number;
  children?: HidCollectionLike[];
};

type HidDeviceLike = {
  vendorId: number;
  productId?: number;
  productName?: string;
  collections?: HidCollectionLike[];
  opened: boolean;
  open: () => Promise<void>;
  close: () => Promise<void>;
  addEventListener: (name: "inputreport", cb: (event: HidInputReportEventLike) => void) => void;
  removeEventListener: (name: "inputreport", cb: (event: HidInputReportEventLike) => void) => void;
};

type HidNavigatorLike = {
  getDevices: () => Promise<HidDeviceLike[]>;
  requestDevice: (options: {
    filters: Array<{
      vendorId?: number;
      usagePage?: number;
      usage?: number;
    }>;
  }) => Promise<HidDeviceLike[]>;
  addEventListener?: (
    name: "connect" | "disconnect",
    cb: (event: { device: HidDeviceLike }) => void,
  ) => void;
};

function hidNavigator(): HidNavigatorLike | null {
  const nav = navigator as Navigator & { hid?: HidNavigatorLike };
  return nav.hid ?? null;
}

let device: HidDeviceLike | null = null;
let bridgeSocket: WebSocket | null = null;
let connected = false;
let inputSource: "none" | "webhid" | "bridge" = "none";
let translation = { x: 0, y: 0, z: 0 };
let rotation = { x: 0, y: 0, z: 0 };
let hidListenersBound = false;
let controlConfig: SpaceMouseControlConfig = loadControlConfig();
let debug: SpaceMouseDebug = {
  reportCount: 0,
  lastReportId: -1,
  lastReportBytes: 0,
  lastReportAt: 0,
  connectedVendorId: 0,
  connectedProductId: 0,
  connectedProductName: "",
  inputSource: "none",
  txRaw: 0,
  tyRaw: 0,
  tzRaw: 0,
  rxRaw: 0,
  ryRaw: 0,
  rzRaw: 0,
};

function clampNumber(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function normalizeControlConfig(raw: Partial<SpaceMouseControlConfig>): SpaceMouseControlConfig {
  return {
    moveSpeed: clampNumber(raw.moveSpeed ?? DEFAULT_CONTROL_CONFIG.moveSpeed, 0.1, 4),
    lateralBoost: clampNumber(raw.lateralBoost ?? DEFAULT_CONTROL_CONFIG.lateralBoost, 0.4, 4),
    rotateSpeed: clampNumber(raw.rotateSpeed ?? DEFAULT_CONTROL_CONFIG.rotateSpeed, 0.1, 4),
    tiltEffect: clampNumber(raw.tiltEffect ?? DEFAULT_CONTROL_CONFIG.tiltEffect, 0, 3),
    invertTilt: Boolean(raw.invertTilt ?? DEFAULT_CONTROL_CONFIG.invertTilt),
    cameraMode:
      raw.cameraMode === "cinematic" || raw.cameraMode === "helicopter"
        ? raw.cameraMode
        : DEFAULT_CONTROL_CONFIG.cameraMode,
  };
}

function loadControlConfig(): SpaceMouseControlConfig {
  if (typeof window === "undefined") return { ...DEFAULT_CONTROL_CONFIG };
  try {
    const raw = window.localStorage.getItem(CONTROL_CONFIG_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONTROL_CONFIG };
    const parsed = JSON.parse(raw) as Partial<SpaceMouseControlConfig>;
    return normalizeControlConfig(parsed);
  } catch {
    return { ...DEFAULT_CONTROL_CONFIG };
  }
}

function broadcastControlConfig(): void {
  window.dispatchEvent(
    new CustomEvent<SpaceMouseControlConfig>("spacemouse-config", { detail: getControlConfig() }),
  );
}

function isLikelySpaceMouseDevice(d: HidDeviceLike): boolean {
  const name = (d.productName || "").toLowerCase();
  const nameHints = name.includes("spacemouse") || name.includes("space mouse") || name.includes("3dconnexion");
  const hasMultiAxisUsage = hasUsageRecursive(d.collections, SPACEMOUSE_USAGE_PAGE, SPACEMOUSE_USAGE);

  // Strict path for known 3Dconnexion hardware.
  if (d.vendorId === 0x256f) return true;

  // Generic HID devices must expose multi-axis usage (or explicit SpaceMouse naming).
  return hasMultiAxisUsage || nameHints;
}

function hasUsageRecursive(
  collections: HidCollectionLike[] | undefined,
  usagePage: number,
  usage: number,
): boolean {
  if (!collections || collections.length === 0) return false;
  for (const col of collections) {
    if (col.usagePage === usagePage && col.usage === usage) return true;
    if (col.children && hasUsageRecursive(col.children, usagePage, usage)) return true;
  }
  return false;
}

function scoreSpaceMouseDevice(d: HidDeviceLike): number {
  const name = (d.productName || "").toLowerCase();
  const nameHints = name.includes("spacemouse") || name.includes("space mouse") || name.includes("3dconnexion");
  const hasMultiAxisUsage = hasUsageRecursive(d.collections, SPACEMOUSE_USAGE_PAGE, SPACEMOUSE_USAGE);
  let score = 0;
  if (d.vendorId === 0x256f) score += 100;
  if (hasMultiAxisUsage) score += 80;
  if (nameHints) score += 50;
  if (/(universal|wireless|cadman|6dof)/.test(name)) score += 30;
  if (name.includes("keyboard") && !name.includes("3d")) score -= 200;
  return score;
}

function pickBestSpaceMouseDevice(devices: HidDeviceLike[]): HidDeviceLike | null {
  const candidates = devices
    .map((d) => ({ d, score: scoreSpaceMouseDevice(d) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return candidates.length > 0 ? candidates[0].d : null;
}

function supported(): boolean {
  return typeof navigator !== "undefined" && "hid" in navigator;
}

function normalizeAxis(raw: number): number {
  const v = Math.max(-1, Math.min(1, raw / AXIS_MAX));
  return Math.abs(v) < DEADZONE ? 0 : v;
}

function normalizeBridgeAxis(raw: number): number {
  const clamped = Math.max(-1, Math.min(1, raw));
  if (Math.abs(clamped) < BRIDGE_DEADZONE) return 0;
  // Slight non-linear curve improves fine control after deadzone.
  return Math.sign(clamped) * Math.pow(Math.abs(clamped), 1.2);
}

/** Reject int16 triples that are clearly not 3Dconnexion axis payloads (e.g. button or misaligned data). */
const MAX_REASONABLE_SPACEMOUSE_INT16 = 2200;

function parse3AxesAtOffset(view: DataView, offset: number): { x: number; y: number; z: number } | null {
  if (view.byteLength < offset + 6) return null;
  const x0 = view.getInt16(offset, true);
  const y0 = view.getInt16(offset + 2, true);
  const z0 = view.getInt16(offset + 4, true);
  if (
    Math.max(Math.abs(x0), Math.abs(y0), Math.abs(z0)) > MAX_REASONABLE_SPACEMOUSE_INT16
  ) {
    return null;
  }
  return {
    x: normalizeAxis(x0),
    y: normalizeAxis(y0),
    z: normalizeAxis(z0),
  };
}

function parseAxesAutoOffset(view: DataView): { x: number; y: number; z: number } | null {
  // Several SpaceMouse firmware variants prepend a marker byte (7-byte reports).
  // For odd payload sizes, prefer offset 1; otherwise use offset 0.
  if (view.byteLength < 6) return null;
  const preferredOffset = view.byteLength % 2 === 1 ? 1 : 0;
  return (
    parse3AxesAtOffset(view, preferredOffset) ??
    parse3AxesAtOffset(view, preferredOffset === 0 ? 1 : 0) ??
    findBest3AxisInBuffer(view)
  );
}

/** If fixed offsets miss (alignment / endian), scan 6-byte windows and pick the strongest plausible triplet. */
function findBest3AxisInBuffer(data: DataView): { x: number; y: number; z: number } | null {
  const n = data.byteLength;
  if (n < 6) return null;
  type Cand = { x: number; y: number; z: number; q: number };
  let best: Cand | null = null;
  const maxO = Math.min(8, n - 6);
  for (let o = 0; o <= maxO; o++) {
    for (const be of [false, true] as const) {
      if (n < o + 6) break;
      const x0 = data.getInt16(o, be);
      const y0 = data.getInt16(o + 2, be);
      const z0 = data.getInt16(o + 4, be);
      const m = Math.max(Math.abs(x0), Math.abs(y0), Math.abs(z0));
      if (m > 4000) continue;
      const q = m;
      if (!best || q > best.q) {
        best = { x: normalizeAxis(x0), y: normalizeAxis(y0), z: normalizeAxis(z0), q };
      }
    }
  }
  if (!best) return null;
  return { x: best.x, y: best.y, z: best.z };
}

function tryParse6Plus6(
  data: DataView,
): { t: { x: number; y: number; z: number } | null; r: { x: number; y: number; z: number } | null } {
  if (data.byteLength < 12) return { t: null, r: null };
  const tOffset = data.byteLength % 2 === 1 ? 1 : 0;
  const rOffset = tOffset + 6;
  if (tOffset + 6 > data.byteLength || rOffset + 6 > data.byteLength) return { t: null, r: null };
  return {
    t: parse3AxesAtOffset(data, tOffset) ?? parse3AxesAtOffset(data, tOffset === 0 ? 1 : 0) ?? null,
    r: parse3AxesAtOffset(data, rOffset) ?? parse3AxesAtOffset(data, rOffset === 6 ? 7 : 6) ?? null,
  };
}

function configuredBridgeUrl(): string {
  const env = (import.meta as { env?: Record<string, unknown> }).env;
  const raw = env?.VITE_SPACEMOUSE_BRIDGE_URL;
  return typeof raw === "string" && raw.trim() ? raw.trim() : "ws://127.0.0.1:8765";
}

/** When true, try the PySpaceMouse WebSocket bridge before WebHID (legacy Safari-oriented order). */
function preferBridgeOverWebHid(): boolean {
  const env = (import.meta as { env?: Record<string, unknown> }).env;
  const raw = env?.VITE_SPACEMOUSE_PREFER_BRIDGE;
  return typeof raw === "string" && /^(1|true|yes|on)$/i.test(raw.trim());
}

/** Skip WebSocket bridge (WebHID only). Use if something on :8765 mimics a bridge and breaks pairing. */
function bridgeDisabled(): boolean {
  const env = (import.meta as { env?: Record<string, unknown> }).env;
  const raw = env?.VITE_SPACEMOUSE_DISABLE_BRIDGE;
  return typeof raw === "string" && /^(1|true|yes|on)$/i.test(raw.trim());
}

function webHidRequestFilters(): Array<{
  vendorId?: number;
  usagePage?: number;
  usage?: number;
}> {
  const out: Array<{ vendorId?: number; usagePage?: number; usage?: number }> = [];
  for (const vendorId of SPACEMOUSE_VENDOR_IDS) {
    out.push({ vendorId });
    out.push({ vendorId, usagePage: SPACEMOUSE_USAGE_PAGE, usage: SPACEMOUSE_USAGE });
  }
  return out;
}

function broadcastStatus(): void {
  window.dispatchEvent(new CustomEvent<SpaceMouseStatus>("spacemouse-status", { detail: getStatus() }));
}

function broadcastDebug(): void {
  window.dispatchEvent(new CustomEvent<SpaceMouseDebug>("spacemouse-debug", { detail: getDebugState() }));
}

function updateDebugReport(reportId: number, data: DataView): void {
  debug.reportCount += 1;
  debug.lastReportId = reportId;
  debug.lastReportBytes = data.byteLength;
  debug.lastReportAt = Date.now();
  broadcastDebug();
}

function onInputReport(event: HidInputReportEventLike): void {
  let reportId = event.reportId;
  let data = event.data;
  if (data.byteLength < 6) return;

  // Some devices deliver reportId=0 and put logical report type in data[0].
  // Example: [1|2, xLo, xHi, yLo, yHi, zLo, zHi]
  if (reportId === 0 && data.byteLength >= 7) {
    const embeddedReportId = data.getUint8(0);
    if (embeddedReportId === 1 || embeddedReportId === 2) {
      reportId = embeddedReportId;
      data = new DataView(data.buffer, data.byteOffset + 1, data.byteLength - 1);
    }
  }

  // 12+ bytes: some firmwares pack translation + rotation in one HID report (rId 0 / nonstandard IDs).
  // Do not run for rId 1 or 2: those are the standard 6-axis reports; 12B payloads are often
  // 6B axes + 6B padding, and a zero second triplet would wipe rotation in the 6+6 path.
  if (data.byteLength >= 12 && (reportId === 0 || reportId > 2)) {
    const { t, r } = tryParse6Plus6(data);
    if (t || r) {
      if (t) translation = t;
      if (r) rotation = r;
      debug.txRaw = translation.x;
      debug.tyRaw = translation.y;
      debug.tzRaw = translation.z;
      debug.rxRaw = rotation.x;
      debug.ryRaw = rotation.y;
      debug.rzRaw = rotation.z;
      updateDebugReport(reportId, data);
      window.dispatchEvent(new Event("spacemouse-motion"));
      return;
    }
  }

  // Common 3Dconnexion report format:
  // report 1 = translation (x/y/z), report 2 = rotation (x/y/z)
  if (reportId === 1) {
    const parsed = parseAxesAutoOffset(data);
    if (parsed) translation = parsed;
    debug.txRaw = translation.x;
    debug.tyRaw = translation.y;
    debug.tzRaw = translation.z;
    updateDebugReport(reportId, data);
    window.dispatchEvent(new Event("spacemouse-motion"));
    return;
  }
  if (reportId === 2) {
    const parsed = parseAxesAutoOffset(data);
    if (parsed) rotation = parsed;
    debug.rxRaw = rotation.x;
    debug.ryRaw = rotation.y;
    debug.rzRaw = rotation.z;
    updateDebugReport(reportId, data);
    window.dispatchEvent(new Event("spacemouse-motion"));
    return;
  }

  // Fallback for unexpected report IDs where 6-byte payload is still axes.
  if (data.byteLength >= 6) {
    const parsed = parseAxesAutoOffset(data);
    if (parsed) {
      translation = parsed;
      debug.txRaw = translation.x;
      debug.tyRaw = translation.y;
      debug.tzRaw = translation.z;
    }
    updateDebugReport(reportId, data);
    window.dispatchEvent(new Event("spacemouse-motion"));
  }
}

async function clearCurrentDevice(closeDevice: boolean): Promise<void> {
  if (!device) return;
  device.removeEventListener("inputreport", onInputReport);
  if (closeDevice && device.opened) {
    try {
      await device.close();
    } catch {
      // ignore close errors
    }
  }
  device = null;
  if (inputSource === "webhid") {
    connected = false;
    inputSource = "none";
  }
  debug.connectedVendorId = 0;
  debug.connectedProductId = 0;
  debug.connectedProductName = "";
  debug.inputSource = inputSource;
}

function clearBridgeConnection(closeSocket: boolean): void {
  if (!bridgeSocket) return;
  const sock = bridgeSocket;
  bridgeSocket = null;
  const wasBridge = inputSource === "bridge";
  if (closeSocket) {
    try {
      sock.close();
    } catch {
      // ignore close errors
    }
  }
  if (inputSource === "bridge") {
    connected = false;
    inputSource = "none";
  }
  if (wasBridge) {
    debug.connectedVendorId = 0;
    debug.connectedProductId = 0;
    debug.connectedProductName = "";
  }
  debug.inputSource = inputSource;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function applyBridgeMotion(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const obj = payload as Record<string, unknown>;
  const tx = asNumber(obj.tx) ?? asNumber(obj.x);
  const ty = asNumber(obj.ty) ?? asNumber(obj.y);
  const tz = asNumber(obj.tz) ?? asNumber(obj.z);
  const rx = asNumber(obj.rx) ?? asNumber(obj.pitch);
  const ry = asNumber(obj.ry) ?? asNumber(obj.roll);
  const rz = asNumber(obj.rz) ?? asNumber(obj.yaw);

  let hadAxis = false;
  const nextTranslation = { ...translation };
  const nextRotation = { ...rotation };
  if (tx !== null) {
    nextTranslation.x = normalizeBridgeAxis(tx);
    hadAxis = true;
  }
  if (ty !== null) {
    nextTranslation.y = normalizeBridgeAxis(ty);
    hadAxis = true;
  }
  if (tz !== null) {
    nextTranslation.z = normalizeBridgeAxis(tz);
    hadAxis = true;
  }
  if (rx !== null) {
    nextRotation.x = normalizeBridgeAxis(rx);
    hadAxis = true;
  }
  if (ry !== null) {
    nextRotation.y = normalizeBridgeAxis(ry);
    hadAxis = true;
  }
  if (rz !== null) {
    nextRotation.z = normalizeBridgeAxis(rz);
    hadAxis = true;
  }
  if (!hadAxis) return false;

  const changedValues =
    Math.abs(nextTranslation.x - translation.x) > 0.0005 ||
    Math.abs(nextTranslation.y - translation.y) > 0.0005 ||
    Math.abs(nextTranslation.z - translation.z) > 0.0005 ||
    Math.abs(nextRotation.x - rotation.x) > 0.0005 ||
    Math.abs(nextRotation.y - rotation.y) > 0.0005 ||
    Math.abs(nextRotation.z - rotation.z) > 0.0005;

  translation = nextTranslation;
  rotation = nextRotation;

  debug.txRaw = translation.x;
  debug.tyRaw = translation.y;
  debug.tzRaw = translation.z;
  debug.rxRaw = rotation.x;
  debug.ryRaw = rotation.y;
  debug.rzRaw = rotation.z;
  const hasMotion =
    Math.abs(translation.x) > 0.001 ||
    Math.abs(translation.y) > 0.001 ||
    Math.abs(translation.z) > 0.001 ||
    Math.abs(rotation.x) > 0.001 ||
    Math.abs(rotation.y) > 0.001 ||
    Math.abs(rotation.z) > 0.001;
  if (hasMotion) debug.reportCount += 1;
  debug.lastReportId = -2; // bridge frame marker
  debug.lastReportBytes = 0;
  debug.lastReportAt = Date.now();
  broadcastDebug();
  if (changedValues && hasMotion) {
    window.dispatchEvent(new Event("spacemouse-motion"));
    return true;
  }
  return false;
}

async function tryConnectBridge(): Promise<boolean> {
  if (bridgeDisabled()) return false;
  if (typeof WebSocket === "undefined") return false;
  if (bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
    connected = true;
    inputSource = "bridge";
    debug.inputSource = inputSource;
    broadcastStatus();
    broadcastDebug();
    return true;
  }
  const url = configuredBridgeUrl();
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const socket = new WebSocket(url);
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        // ignore
      }
      resolve(false);
    }, BRIDGE_CONNECT_TIMEOUT_MS);

    socket.onopen = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      clearBridgeConnection(false);
      bridgeSocket = socket;
      connected = true;
      inputSource = "bridge";
      debug.inputSource = inputSource;
      debug.connectedVendorId = 0x256f;
      debug.connectedProductId = 0;
      debug.connectedProductName = "PySpaceMouse Bridge";
      broadcastStatus();
      broadcastDebug();
      resolve(true);
    };
    socket.onmessage = (ev: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(ev.data);
        void applyBridgeMotion(parsed);
      } catch {
        // ignore invalid bridge frames
      }
    };
    socket.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(false);
    };
    socket.onclose = () => {
      if (bridgeSocket === socket) {
        clearBridgeConnection(false);
        broadcastStatus();
        broadcastDebug();
      }
      if (!settled) {
        settled = true;
        window.clearTimeout(timeout);
        resolve(false);
      }
    };
  });
}

export function getStatus(): SpaceMouseStatus {
  // Bridge works in browsers without WebHID (e.g. Safari).
  if (inputSource === "bridge" && connected) {
    return { supported: true, connected: true, label: "Connected: PySpaceMouse Bridge" };
  }
  if (!supported()) {
    return {
      supported: false,
      connected: false,
      label: "WebHID unavailable — use Chrome/Edge on https or localhost, or run script/spacemouse_bridge.py",
    };
  }
  if (!connected || !device) {
    return {
      supported: true,
      connected: false,
      label: "Disconnected — open 3D Mouse and allow your SpaceMouse in the browser prompt",
    };
  }
  if (inputSource === "bridge") {
    return { supported: true, connected: true, label: "Connected: PySpaceMouse Bridge" };
  }
  return {
    supported: true,
    connected: true,
    label: `Connected: ${device.productName || "3D Mouse"}`,
  };
}

export function getMotion(): SpaceMouseMotion {
  return {
    tx: translation.x,
    ty: translation.y,
    tz: translation.z,
    rx: rotation.x,
    ry: rotation.y,
    rz: rotation.z,
  };
}

export function getControlConfig(): SpaceMouseControlConfig {
  return { ...controlConfig };
}

export function setControlConfig(partial: Partial<SpaceMouseControlConfig>): SpaceMouseControlConfig {
  controlConfig = normalizeControlConfig({ ...controlConfig, ...partial });
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CONTROL_CONFIG_STORAGE_KEY, JSON.stringify(controlConfig));
    } catch {
      // ignore storage errors
    }
    broadcastControlConfig();
  }
  return getControlConfig();
}

export function resetControlConfig(): SpaceMouseControlConfig {
  controlConfig = { ...DEFAULT_CONTROL_CONFIG };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CONTROL_CONFIG_STORAGE_KEY, JSON.stringify(controlConfig));
    } catch {
      // ignore storage errors
    }
    broadcastControlConfig();
  }
  return getControlConfig();
}

export function getDebugState(): SpaceMouseDebug {
  return { ...debug };
}

async function attachDevice(next: HidDeviceLike): Promise<void> {
  clearBridgeConnection(true);
  if (device && device !== next) {
    await clearCurrentDevice(true);
  }
  if (!next.opened) await next.open();
  // Re-subscribe if we re-attach the same object (e.g. React Strict Mode) so we never stack listeners.
  next.removeEventListener("inputreport", onInputReport);
  next.addEventListener("inputreport", onInputReport);
  device = next;
  connected = true;
  inputSource = "webhid";
  debug.connectedVendorId = next.vendorId;
  debug.connectedProductId = next.productId ?? 0;
  debug.connectedProductName = next.productName ?? "";
  debug.inputSource = inputSource;
  broadcastStatus();
  broadcastDebug();
}

async function tryReconnectKnownDevice(): Promise<void> {
  const hid = hidNavigator();
  if (!hid) return;
  const granted = await hid.getDevices();
  const known = pickBestSpaceMouseDevice(granted);
  if (!known) return;
  await attachDevice(known);
}

function ensureHidListeners(): void {
  const hid = hidNavigator();
  if (!hid || hidListenersBound) return;
  if (typeof hid.addEventListener !== "function") {
    hidListenersBound = true;
    return;
  }

  hid.addEventListener("disconnect", ({ device: disconnectedDevice }) => {
    if (!device) return;
    const sameDevice =
      disconnectedDevice === device ||
      (disconnectedDevice.vendorId === device.vendorId &&
        (disconnectedDevice.productName || "") === (device.productName || ""));
    if (!sameDevice) return;
    translation = { x: 0, y: 0, z: 0 };
    rotation = { x: 0, y: 0, z: 0 };
    void clearCurrentDevice(false).then(() => {
      broadcastStatus();
      void tryReconnectKnownDevice();
    });
  });

  hid.addEventListener("connect", ({ device: connectedDevice }) => {
    if (connected || !isLikelySpaceMouseDevice(connectedDevice)) return;
    void attachDevice(connectedDevice);
  });

  hidListenersBound = true;
}

export async function connectSpaceMouse(): Promise<SpaceMouseStatus> {
  // If something is listening on the bridge port but not a real SpaceMouse (or the device is
  // unavailable), the old "bridge first" order left WebHID unused and the hardware looked dead.
  if (preferBridgeOverWebHid() && (await tryConnectBridge())) return getStatus();

  const hid = hidNavigator();
  if (hid) {
    ensureHidListeners();
    const granted = await hid.getDevices();
    const known = pickBestSpaceMouseDevice(granted);
    if (known) {
      await attachDevice(known);
      return getStatus();
    }
    try {
      const picked = await hid.requestDevice({
        filters: webHidRequestFilters(),
      });
      if (picked && picked.length > 0) {
        const selected = pickBestSpaceMouseDevice(picked) ?? picked[0];
        await attachDevice(selected);
        return getStatus();
      }
    } catch {
      // user cancelled the device chooser; fall through to bridge
    }
  }

  if (await tryConnectBridge()) return getStatus();
  return getStatus();
}

export async function disconnectSpaceMouse(): Promise<SpaceMouseStatus> {
  translation = { x: 0, y: 0, z: 0 };
  rotation = { x: 0, y: 0, z: 0 };
  clearBridgeConnection(true);
  debug = {
    reportCount: 0,
    lastReportId: -1,
    lastReportBytes: 0,
    lastReportAt: 0,
    connectedVendorId: 0,
    connectedProductId: 0,
    connectedProductName: "",
    inputSource: "none",
    txRaw: 0,
    tyRaw: 0,
    tzRaw: 0,
    rxRaw: 0,
    ryRaw: 0,
    rzRaw: 0,
  };
  await clearCurrentDevice(true);
  broadcastStatus();
  broadcastDebug();
  return getStatus();
}

export async function initSpaceMouseAutoReconnect(): Promise<void> {
  if (preferBridgeOverWebHid() && (await tryConnectBridge())) return;
  const hid = hidNavigator();
  if (hid) {
    ensureHidListeners();
    const granted = await hid.getDevices();
    const known = pickBestSpaceMouseDevice(granted);
    if (known) {
      await attachDevice(known);
      return;
    }
  }
  // Do not auto-open the WebSocket bridge on load: a listener on :8765 can look "connected" with no
  // motion, blocking real WebHID until disconnect. The user connects via the 3D Mouse button instead.
  broadcastStatus();
}
