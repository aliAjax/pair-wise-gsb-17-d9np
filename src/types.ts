// ---------- 资料层：钻孔连续分层 ----------
export interface Layer {
  top: number; // 层顶深度 m
  bottom: number; // 层底深度 m
  name: string; // 岩性
  desc?: string;
}

export interface Borehole {
  holeId: string;
  totalDepth: number;
  waterLevel: number | null; // 地下水位 m
  layers: Layer[];
}

// ---------- 资料层：压水试验登记 ----------
export type StageKey = "s1" | "s2" | "s3";
export const STAGE_KEYS: StageKey[] = ["s1", "s2", "s3"];
export const STAGE_LABELS = ["第一级", "第二级", "第三级"];

export interface StageReading {
  pressure: string; // 实测表压 MPa
  flow: string; // 流量 L/min
  minutes: string; // 该级持续时长 min
}

export type StageMap = Record<StageKey, StageReading>;

export interface TestRegistration {
  id: string;
  holeId: string;
  segmentTop: string; // 试段顶深 m
  segmentBottom: string; // 试段底深 m
  setPressure: string; // 设定试验压力 MPa
  pipeLoss: string; // 管路损失 MPa
  stages: StageMap;
  testDate: string;
  operator: string; // 现场记录人
  retestOf?: string; // 本试段是哪条登记的复测
}

// ---------- 判定层 ----------
export type IssueCode =
  | "INCOMPLETE"
  | "INVALID_DEPTH"
  | "CROSS_LAYER"
  | "PRESSURE_DEVIATION"
  | "FLOW_UNSTABLE";

export interface Issue {
  code: IssueCode;
  label: string;
  detail: string;
}

export type KUnit = "m/d" | "cm/s";

export interface KValue {
  value: string;
  unit: KUnit;
}

// 冻结时留存的版本快照：资料 + 结果一并固化，事后改值另起版本
export interface FrozenVersion {
  version: number;
  k: KValue;
  lu: string | null;
  reason?: string;
  confirmedBy: string;
  confirmedAt: string;
  snapshot: TestRegistration;
}

// 待复核 / 已确认等判定状态，与资料分开存放
export type VerdictStatus =
  | "draft" // 草稿，尚未提交判定
  | "pending" // 待复核：存在硬性问题，须复测
  | "qualified" // 判定通过，等待负责人确认 K
  | "frozen" // 负责人已确认，结果冻结
  | "superseded"; // 已由复测记录替代

export interface Verdict {
  regId: string;
  status: VerdictStatus;
  note: string; // 待复核原因说明（现场补充）
  submittedAt?: string;
  submittedBy?: string;
  confirmedBy?: string;
  confirmedAt?: string;
  k?: KValue;
  versions: FrozenVersion[];
  retestIds: string[];
  supersededById?: string;
  updatedAt: string;
}
