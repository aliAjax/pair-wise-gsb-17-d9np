import type { Borehole, TestRegistration, Verdict } from "./types";

// 资料、判定、本机状态分库保存，互不覆盖
const KEY_DATA = "pwt:data:v1"; // 钻孔分层 + 试验登记（资料）
const KEY_VERDICTS = "pwt:verdicts:v1"; // 复核判定与冻结版本（判定）
const KEY_UI = "pwt:ui:v1"; // 本机状态：当前孔号、筛选（本机保存）

export interface DataStore {
  boreholes: Borehole[];
  registrations: TestRegistration[];
  seq: number;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式或配额不足时静默：本机保存失败不影响当次复核
  }
}

export function loadData(): DataStore {
  return read<DataStore>(KEY_DATA, seed());
}
export function saveData(d: DataStore): void {
  write(KEY_DATA, d);
}

export function loadVerdicts(): Record<string, Verdict> {
  return read<Record<string, Verdict>>(KEY_VERDICTS, {});
}
export function saveVerdicts(v: Record<string, Verdict>): void {
  write(KEY_VERDICTS, v);
}

export interface UiState {
  currentHoleId: string;
  tab: "pending" | "qualified" | "frozen" | "all";
}
export function loadUi(): UiState {
  return read<UiState>(KEY_UI, { currentHoleId: "ZK-18", tab: "pending" });
}
export function saveUi(u: UiState): void {
  write(KEY_UI, u);
}

export function newId(seq: number): string {
  return `YS-${String(seq).padStart(3, "0")}`;
}

// ---------- 初始资料：连续分层（层底即下一层顶，避免与试段错位） ----------
function seed(): DataStore {
  const boreholes: Borehole[] = [
    {
      holeId: "ZK-18",
      totalDepth: 22.6,
      waterLevel: 3.4,
      layers: [
        { top: 0, bottom: 4.2, name: "粉质黏土", desc: "可塑，水位3.4m" },
        { top: 4.2, bottom: 9.0, name: "强风化泥岩", desc: "岩芯破碎" },
        { top: 9.0, bottom: 15.6, name: "中风化砂岩", desc: "节理发育" },
        { top: 15.6, bottom: 22.6, name: "微风化砂岩", desc: "岩芯完整率82%" },
      ],
    },
    {
      holeId: "ZK-21",
      totalDepth: 31.2,
      waterLevel: 5.1,
      layers: [
        { top: 0, bottom: 3.0, name: "杂填土" },
        { top: 3.0, bottom: 8.4, name: "粉砂", desc: "稍密~中密" },
        { top: 8.4, bottom: 14.0, name: "卵石层", desc: "夹中粗砂" },
        { top: 14.0, bottom: 22.5, name: "强风化花岗岩" },
        { top: 22.5, bottom: 31.2, name: "中风化花岗岩" },
      ],
    },
    {
      holeId: "ZK-24",
      totalDepth: 18.4,
      waterLevel: null,
      layers: [
        { top: 0, bottom: 2.6, name: "黏土", desc: "硬塑" },
        { top: 2.6, bottom: 9.8, name: "强风化泥岩", desc: "芯样完整率62%" },
        { top: 9.8, bottom: 18.4, name: "中风化泥岩" },
      ],
    },
  ];

  const registrations: TestRegistration[] = [
    {
      // 同层、压力与流量均合格
      id: "YS-001",
      holeId: "ZK-18",
      segmentTop: "10.0",
      segmentBottom: "15.0",
      setPressure: "1.00",
      pipeLoss: "0.05",
      stages: {
        s1: { pressure: "1.06", flow: "7.80", minutes: "20" },
        s2: { pressure: "1.05", flow: "7.55", minutes: "20" },
        s3: { pressure: "1.05", flow: "7.48", minutes: "20" },
      },
      testDate: "2026-09-24",
      operator: "王编录",
    },
    {
      // 跨层 + 压力偏离：留在待复核
      id: "YS-002",
      holeId: "ZK-18",
      segmentTop: "8.0",
      segmentBottom: "12.0",
      setPressure: "1.00",
      pipeLoss: "0.05",
      stages: {
        s1: { pressure: "1.20", flow: "12.4", minutes: "15" },
        s2: { pressure: "1.21", flow: "11.0", minutes: "15" },
        s3: { pressure: "1.19", flow: "10.9", minutes: "15" },
      },
      testDate: "2026-09-24",
      operator: "王编录",
    },
    {
      // 后两级流量未稳定
      id: "YS-003",
      holeId: "ZK-21",
      segmentTop: "15.0",
      segmentBottom: "20.0",
      setPressure: "0.80",
      pipeLoss: "0.04",
      stages: {
        s1: { pressure: "0.84", flow: "18.2", minutes: "20" },
        s2: { pressure: "0.85", flow: "16.5", minutes: "20" },
        s3: { pressure: "0.84", flow: "13.1", minutes: "20" },
      },
      testDate: "2026-09-25",
      operator: "李记录",
    },
  ];

  return { boreholes, registrations, seq: 4 };
}
