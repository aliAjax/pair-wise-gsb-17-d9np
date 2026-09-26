// ===== 压水试验复核规则（判定层，不触碰原始资料）=====
import type {
  Evaluation,
  Flag,
  FlagCode,
  Hole,
  Round,
  Stage,
  TestRecord,
} from "./types";

/** 允许偏离比例：压力偏离设定值、后两级折算流量差，阈值均为一成（10%） */
export const TOLERANCE = 0.1;

const GAMMA_W = 9.8; // kN/m³，水柱每米 ≈ 0.0098 MPa
export const waterColumn = (depthM: number) => (depthM * GAMMA_W) / 1000;

/** 试段中点深度 */
export const midDepth = (test: TestRecord) => (test.top + test.bottom) / 2;

/** 需要写明原因的命中规则 */
export type ReasonCode = Exclude<FlagCode, "INCOMPLETE">;

/** 试段是否跨层：分层界线落在试段区间内部即跨层 */
export function getCrossedLayers(hole: Hole, test: TestRecord): string[] {
  return hole.layers
    .filter((l) => l.top > test.top + 1e-9 && l.top < test.bottom - 1e-9)
    .map((l) => `${l.lithology}（${l.top}m 分界）`);
}

function roundComplete(round: Round): boolean {
  return (
    Number.isFinite(round.pipeLoss) &&
    round.stages.every(
      (s) =>
        Number.isFinite(s.setPressure) &&
        Number.isFinite(s.pressure) &&
        Number.isFinite(s.flow) &&
        Number.isFinite(s.minutes) &&
        s.setPressure > 0 &&
        s.pressure > 0 &&
        s.flow > 0 &&
        s.minutes > 0
    )
  );
}

/**
 * 对一次测次执行规则判定：
 * 1. 压力偏离设定值超过一成（按级判）；
 * 2. 后两级折算流量（q=Q/P，单位透水率）差超过一成——
 *    稳定压水试验应按折算值比较，否则不同压力级的原始流量天然不可比。
 * Lugeon：q = Q / (P · L)，Q 取 L/min，P 取有效压力 MPa，L 取试段长 m。
 */
export function evaluateRound(
  hole: Hole,
  test: TestRecord,
  round: Round
): Evaluation {
  const flags: Flag[] = [];
  const mid = midDepth(test);
  const wc = waterColumn(mid);
  const len = test.bottom - test.top;

  const crossed = getCrossedLayers(hole, test);
  if (crossed.length > 0) {
    flags.push({
      code: "CROSS_LAYER",
      detail: `试段 ${test.top}–${test.bottom}m 跨层，内部界线：${crossed.join("、")}`,
    });
  }

  if (!roundComplete(round)) {
    flags.push({ code: "INCOMPLETE", detail: "三级读数、时长或管路损失未填全（须全部为正数）" });
    return { flags, effective: [0, 0, 0], unitRates: [0, 0, 0] };
  }

  const effective = round.stages.map(
    (s) => s.pressure - round.pipeLoss + wc
  ) as Evaluation["effective"];

  const unitRates = round.stages.map((s, i) => s.flow / (effective[i] * len)) as Evaluation[
    "unitRates"
  ];

  round.stages.forEach((s: Stage, i: number) => {
    const dev = Math.abs(s.pressure - s.setPressure) / s.setPressure;
    if (dev > TOLERANCE) {
      flags.push({
        code: "PRESSURE_DEV",
        stage: i + 1,
        detail: `第${i + 1}级实测压力 ${s.pressure}MPa 偏离设定 ${s.setPressure}MPa ${(dev * 100).toFixed(1)}%，超过一成`,
      });
    }
  });

  const q2 = unitRates[1];
  const q3 = unitRates[2];
  const diff = Math.abs(q3 - q2) / Math.max(q2, q3);
  if (diff > TOLERANCE) {
    flags.push({
      code: "FLOW_DIFF",
      stage: 3,
      detail: `后两级折算透水率 ${q2.toFixed(2)} / ${q3.toFixed(2)} Lu，差异 ${(diff * 100).toFixed(1)}%，超过一成`,
    });
  }

  return { flags, effective, unitRates };
}

/** 汇总一条试段历次测次命中的规则（并集），作为待复核原因编码表 */
export function collectReasons(
  hole: Hole,
  test: TestRecord
): { flags: Flag[]; byCode: Set<FlagCode>; last: Evaluation } {
  const byCode = new Set<FlagCode>();
  const flags: Flag[] = [];
  let last: Evaluation = { flags: [], effective: [0, 0, 0], unitRates: [0, 0, 0] };

  // 跨层是试段固有特征：即使尚无测次也要提示
  const crossed = getCrossedLayers(hole, test);
  if (crossed.length > 0) {
    const f: Flag = {
      code: "CROSS_LAYER",
      detail: `试段 ${test.top}–${test.bottom}m 跨层，内部界线：${crossed.join("、")}`,
    };
    byCode.add("CROSS_LAYER");
    flags.push(f);
  }

  for (const r of test.rounds) {
    last = evaluateRound(hole, test, r);
    for (const f of last.flags) {
      if (f.code === "CROSS_LAYER") continue; // 跨层只登记一次
      byCode.add(f.code);
      flags.push(f);
    }
  }
  return { flags, byCode, last };
}

/**
 * 能否从待复核转入待确认：
 * - 最新测次读数完整；
 * - 每个命中规则都写明了原因；
 * - 必须有复测（或修订补测），且最新测次不再命中压力/流量规则；
 *   跨层属于试段固有特征，允许凭"跨层取值说明 + 复测"放行。
 */
export function canResolveReview(
  hole: Hole,
  test: TestRecord,
  reasonText: Partial<Record<ReasonCode, string>>
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  const { byCode, last } = collectReasons(hole, test);
  const latest = test.rounds[test.rounds.length - 1];

  if (latest && last.flags.some((f) => f.code === "INCOMPLETE")) {
    missing.push("最新测次读数不完整");
  }

  for (const code of byCode) {
    if (code === "INCOMPLETE") continue;
    if (!reasonText[code]?.trim()) missing.push(REASON_LABEL[code]);
  }

  const hasRetest = test.rounds.some((r) => r.kind !== "initial");
  if (byCode.size > 0 && !hasRetest) missing.push("尚未复测");

  if (latest && latest.kind !== "initial") {
    const stillBad = last.flags.some(
      (f) => f.code === "PRESSURE_DEV" || f.code === "FLOW_DIFF"
    );
    if (stillBad) missing.push("最新复测的压力或流量仍未稳定");
  }

  return { ok: missing.length === 0, missing };
}

export const FLAG_LABEL: Record<FlagCode, string> = {
  CROSS_LAYER: "试段跨层",
  PRESSURE_DEV: "压力偏离超过一成",
  FLOW_DIFF: "后两级流量差超过一成",
  INCOMPLETE: "读数不完整",
};

export const REASON_LABEL: Record<ReasonCode, string> = {
  CROSS_LAYER: "跨层取值说明",
  PRESSURE_DEV: "压力偏离原因",
  FLOW_DIFF: "流量不稳原因",
};
