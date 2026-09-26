// ===== 渗透系数解析解：透水率 Lu + Hvorslev 栓塞段公式 =====
import type { Hole, Round, TestRecord } from "./types";
import { midDepth, waterColumn } from "./rules";

/** 透水率（Lugeon）：q = Q / (P·L)，三级取均值 */
export function lugeon(test: TestRecord, round: Round): number {
  const len = test.bottom - test.top;
  const wc = waterColumn(midDepth(test));
  const q = round.stages.map((s) => {
    const p = s.pressure - round.pipeLoss + wc;
    return p > 0 ? s.flow / (p * len) : 0;
  });
  return q.reduce((a, b) => a + b, 0) / q.length;
}

/**
 * 建议渗透系数（m/d），Hvorslev 圆柱栓塞段解析解：
 *   k = Q · ln( (√(L²+4r²)+L) / (√(L²+4r²)−L) ) / (2π L H)
 * Q m³/d，L 试段长 m，r 钻孔半径 m，H 有效水头 m；三级取均值。
 * 该值仅为建议值，最终以负责人确认值为准并冻结。
 */
export function suggestedK(hole: Hole, test: TestRecord, round: Round): number {
  const len = test.bottom - test.top;
  const wc = waterColumn(midDepth(test));
  const inner = Math.sqrt(len * len + 4 * hole.radius * hole.radius);
  const shape = Math.log((inner + len) / (inner - len));

  const values = round.stages.map((s) => {
    const p = s.pressure - round.pipeLoss + wc; // 有效压力 MPa ≈ 100 m 水头 / MPa
    const head = p * 100;
    const qM3D = s.flow * 60 * 24 / 1000; // L/min → m³/d
    return head > 0 ? (qM3D * shape) / (2 * Math.PI * len * head) : 0;
  });
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export const round4 = (n: number) => (Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0);
