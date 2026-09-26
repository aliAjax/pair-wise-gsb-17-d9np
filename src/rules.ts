import type {
  Borehole,
  FrozenVersion,
  Issue,
  StageKey,
  StageReading,
  TestRegistration,
} from "./types";
import { STAGE_KEYS } from "./types";

const num = (s: string): number | null => {
  if (s === undefined || s === null) return null;
  const t = String(s).trim();
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

/** 找出试段 [top,bottom] 跨越的所有连续分层；落在同一层内返回单层 */
export function spanLayers(
  hole: Borehole,
  top: number,
  bottom: number
): { name: string; top: number; bottom: number }[] {
  const hit: { name: string; top: number; bottom: number }[] = [];
  for (const layer of hole.layers) {
    // 层与试段有实际重叠（容差 1cm，避免界面深度恰好相等时误判跨层）
    if (layer.bottom > top + 0.01 && layer.top < bottom - 0.01) {
      hit.push({ name: layer.name, top: layer.top, bottom: layer.bottom });
    }
  }
  return hit;
}

function stageFilled(r: StageReading): boolean {
  return (
    num(r.pressure) !== null &&
    num(r.flow) !== null &&
    num(r.minutes) !== null
  );
}

const DEVIATION_LIMIT = 0.1; // 压力偏离设定值一成
const FLOW_DIFF_LIMIT = 0.1; // 后两级流量差一成

/**
 * 判定核心：纯函数，只依赖资料，不读写保存层。
 * 三类硬性问题：试段跨层 / 压力偏离设定值 >10% / 后两级流量差 >10%。
 */
export function evaluate(
  reg: TestRegistration,
  hole: Borehole | undefined
): { issues: Issue[]; complete: boolean; metrics: EvalMetrics } {
  const issues: Issue[] = [];
  const pushIssue = (issue: Issue) => {
    // 同类硬性问题只保留一条（如三级压力均偏离，只列最大偏离级）
    if (!issues.some((i) => i.code === issue.code)) issues.push(issue);
  };
  const top = num(reg.segmentTop);
  const bottom = num(reg.segmentBottom);
  const setP = num(reg.setPressure);
  const loss = num(reg.pipeLoss);

  const filled = STAGE_KEYS.every((k) => stageFilled(reg.stages[k]));
  const baseFilled =
    top !== null &&
    bottom !== null &&
    setP !== null &&
    loss !== null &&
    reg.holeId.trim() !== "";

  const complete = filled && baseFilled;
  if (!complete) {
    issues.push({
      code: "INCOMPLETE",
      label: "资料不齐",
      detail: "试段深度、设定压力、管路损失及三级压力/流量/时长须全部填写。",
    });
  }

  // 深度合理性
  let spanned: { name: string; top: number; bottom: number }[] = [];
  if (top !== null && bottom !== null) {
    if (bottom <= top) {
      issues.push({
        code: "INVALID_DEPTH",
        label: "试段深度有误",
        detail: `试段底深 ${bottom}m 不大于顶深 ${top}m。`,
      });
    } else if (hole && (top < 0 || bottom > hole.totalDepth + 0.01)) {
      issues.push({
        code: "INVALID_DEPTH",
        label: "试段越界",
        detail: `试段超出 ${hole.holeId} 孔深 0~${hole.totalDepth}m 范围。`,
      });
    } else if (hole) {
      spanned = spanLayers(hole, top, bottom);
      if (spanned.length === 0) {
        issues.push({
          code: "INVALID_DEPTH",
          label: "试段未落在分层内",
          detail: "该深度区间与已编录分层无对应，请核对分层或试段深度。",
        });
      } else if (spanned.length > 1) {
        issues.push({
          code: "CROSS_LAYER",
          label: "试段跨层",
          detail: `试段跨 ${spanned.length} 个分层：${spanned
            .map((l) => `${l.name}(${l.top}~${l.bottom}m)`)
            .join("、")}。`,
        });
      }
    }
  }

  // 压力偏离（用扣除管路损失后的有效压力与设定值比较，逐级检查）
  const devs: { stage: StageKey; ratio: number; effective: number; raw: number }[] = [];
  if (setP !== null && loss !== null && setP > 0) {
    for (const k of STAGE_KEYS) {
      const p = num(reg.stages[k].pressure);
      if (p === null) continue;
      const effective = p - loss;
      const ratio = Math.abs(effective - setP) / setP;
      devs.push({ stage: k, ratio, effective, raw: p });
    }
    const worst = devs
      .filter((d) => d.ratio > DEVIATION_LIMIT)
      .sort((a, b) => b.ratio - a.ratio)[0];
    if (worst) {
      pushIssue({
        code: "PRESSURE_DEVIATION",
        label: "压力偏离设定值超过一成",
        detail: `${stageName(worst.stage)}偏离最大：有效压力 ${worst.effective.toFixed(
          3
        )}MPa（表压 ${worst.raw}−损失 ${loss}），偏离设定值 ${setP}MPa 达 ${(
          worst.ratio * 100
        ).toFixed(1)}%。`,
      });
    }
  }

  // 后两级流量稳定性：|Q3-Q2| / Q2 > 10%
  let flowRatio: number | null = null;
  const q2 = num(reg.stages.s2.flow);
  const q3 = num(reg.stages.s3.flow);
  if (q2 !== null && q3 !== null) {
    if (q2 === 0) {
      if (q3 !== 0) flowRatio = 1;
    } else {
      flowRatio = Math.abs(q3 - q2) / q2;
    }
    if (flowRatio !== null && flowRatio > FLOW_DIFF_LIMIT) {
      pushIssue({
        code: "FLOW_UNSTABLE",
        label: "后两级流量差超过一成",
        detail: `第二级流量 ${q2}L/min、第三级 ${q3}L/min，相差 ${(
          flowRatio * 100
        ).toFixed(1)}%，流量未稳定。`,
      });
    }
  }

  return {
    issues,
    complete,
    metrics: { spanned, devs, flowRatio, setP, loss },
  };
}

export interface EvalMetrics {
  spanned: { name: string; top: number; bottom: number }[];
  devs: {
    stage: StageKey;
    ratio: number;
    effective: number;
    raw: number;
  }[];
  flowRatio: number | null;
  setP: number | null;
  loss: number | null;
}

export function stageName(k: StageKey): string {
  return STAGE_KEYS.indexOf(k) === -1
    ? ""
    : ["第一级", "第二级", "第三级"][STAGE_KEYS.indexOf(k)];
}

/**
 * 吕荣值 Lu = Q / (P·L)，Q L/min，P 有效压力 MPa，L 试段长度 m。
 * 取第三级（稳定级）计算；资料不齐返回 null。
 */
export function calcLu(reg: TestRegistration): number | null {
  const top = num(reg.segmentTop);
  const bottom = num(reg.segmentBottom);
  const loss = num(reg.pipeLoss);
  const p3 = num(reg.stages.s3.pressure);
  const q3 = num(reg.stages.s3.flow);
  if ([top, bottom, loss, p3, q3].some((v) => v === null)) return null;
  const length = (bottom as number) - (top as number);
  const pe = (p3 as number) - (loss as number);
  if (length <= 0 || pe <= 0) return null;
  return q3! / pe / length;
}

/**
 * 冻结快照：负责人确认时，把当时资料与 K 值一并固化，
 * 事后改值只能新增带原因的版本，原版本保留。
 */
export function nextVersion(
  versions: FrozenVersion[],
  reg: TestRegistration,
  k: { value: string; unit: "m/d" | "cm/s" },
  lu: string | null,
  confirmedBy: string,
  reason?: string
): FrozenVersion {
  return {
    version: versions.length + 1,
    k,
    lu,
    reason: reason?.trim() || undefined,
    confirmedBy,
    confirmedAt: new Date().toISOString(),
    snapshot: JSON.parse(JSON.stringify(reg)),
  };
}
