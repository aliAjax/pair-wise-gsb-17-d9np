// ===== 压水试验复核台 · 领域模型 =====
// 资料（分层、试段、各级读数）与判定（复核结论、确认版本）在类型上即分开。

/** 钻孔分层——来自钻孔编录的连续分层资料 */
export interface Layer {
  id: string;
  top: number; // 层顶深度 m
  bottom: number; // 层底深度 m
  lithology: string; // 岩性
  state: string; // 状态描述
  note?: string;
}

/** 钻孔基础资料 */
export interface Hole {
  id: string; // 孔号，如 ZK-18
  depth: number; // 孔深 m
  radius: number; // 钻孔半径 m，用于渗透系数解析解
  layers: Layer[];
}

/** 单级压力读数：三级压力中的一级 */
export interface Stage {
  setPressure: number; // 设定表压 MPa
  pressure: number; // 实测表压 MPa（现场抄录值）
  flow: number; // 稳定流量 L/min（现场抄录值）
  minutes: number; // 本级持续时长 min
}

export type RoundKind = "initial" | "retest" | "amend";

/** 一次测次：初测 / 复测 / 事后修订补测，三级读数 + 管路损失 */
export interface Round {
  id: string;
  kind: RoundKind;
  at: string; // ISO 时间
  pipeLoss: number; // 管路压力损失 MPa（现场抄录值）
  stages: [Stage, Stage, Stage];
}

/** 试段资料：在某孔连续分层上圈定的深度区间，附历次测次读数 */
export interface TestRecord {
  id: string;
  holeId: string;
  top: number; // 试段顶深 m（对齐分层界线）
  bottom: number; // 试段底深 m
  createdAt: string;
  rounds: Round[]; // 资料只读累积：初测、复测、补测只追加
}

export type FlagCode = "CROSS_LAYER" | "PRESSURE_DEV" | "FLOW_DIFF" | "INCOMPLETE";

/** 判定规则命中项 */
export interface Flag {
  code: FlagCode;
  stage?: number; // 命中的压力级（1/2/3）
  detail: string; // 可读说明
}

/** 一次测次的判定结果 */
export interface Evaluation {
  flags: Flag[];
  effective: [number, number, number]; // 各级有效压力 MPa
  unitRates: [number, number, number]; // 各级折算透水率 Lu
}

/** 冻结的结果版本 */
export interface FrozenVersion {
  version: number;
  createdAt: string;
  confirmer: string; // 负责人
  roundId: string; // 本版本依据的测次
  qLu: number; // 透水率 Lu
  kSuggested: number; // 解析解建议渗透系数 m/d
  kConfirmed: number; // 负责人确认的渗透系数 m/d
  changeReason?: string; // v2+ 必填：事后改值原因
}

export type VerdictStatus = "pending_review" | "awaiting_confirm" | "confirmed";

/** 判定记录：与试段资料分库存放 */
export interface Verdict {
  testId: string;
  status: VerdictStatus;
  /** 待复核原因说明，按命中规则编码填写（INCOMPLETE 不写原因，只阻断提交） */
  reasonText: Partial<Record<Exclude<FlagCode, "INCOMPLETE">, string>>;
  versions: FrozenVersion[]; // 冻结版本只增不改
  updatedAt: string;
}

export const ROUND_LABEL: Record<RoundKind, string> = {
  initial: "初测",
  retest: "复测",
  amend: "修订补测",
};

export const STATUS_LABEL: Record<VerdictStatus, string> = {
  pending_review: "待复核",
  awaiting_confirm: "待确认",
  confirmed: "已确认 · 已冻结",
};
