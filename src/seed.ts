// ===== 首次启动的示例资料（仅在本机资料库为空时写入）=====
import type { Hole, TestRecord, Verdict } from "./types";

export const seedHoles: Hole[] = [
  {
    id: "ZK-18",
    depth: 22.6,
    radius: 0.0375,
    layers: [
      { id: "l18-1", top: 0, bottom: 3.4, lithology: "杂填土", state: "松散" },
      { id: "l18-2", top: 3.4, bottom: 11.4, lithology: "粉质黏土", state: "可塑" },
      { id: "l18-3", top: 11.4, bottom: 16.4, lithology: "强风化泥岩", state: "破碎" },
      { id: "l18-4", top: 16.4, bottom: 22.6, lithology: "中风化砂岩", state: "较完整" },
    ],
  },
  {
    id: "ZK-21",
    depth: 31.2,
    radius: 0.0375,
    layers: [
      { id: "l21-1", top: 0, bottom: 4.1, lithology: "粉砂", state: "稍密" },
      { id: "l21-2", top: 4.1, bottom: 9.6, lithology: "粉质黏土", state: "可塑" },
      { id: "l21-3", top: 9.6, bottom: 14.8, lithology: "卵石层", state: "中密", note: "夹中粗砂" },
      { id: "l21-4", top: 14.8, bottom: 31.2, lithology: "强风化花岗岩", state: "裂隙发育" },
    ],
  },
  {
    id: "ZK-24",
    depth: 18.4,
    radius: 0.0385,
    layers: [
      { id: "l24-1", top: 0, bottom: 2.8, lithology: "素填土", state: "松散" },
      { id: "l24-2", top: 2.8, bottom: 6.2, lithology: "粉质黏土", state: "硬塑" },
      { id: "l24-3", top: 6.2, bottom: 11.2, lithology: "强风化泥岩", state: "碎裂结构" },
      { id: "l24-4", top: 11.2, bottom: 18.4, lithology: "中风化泥岩", state: "芯样完整率62%" },
    ],
  },
];

export const seedTests: TestRecord[] = [
  // ZK-18：单段内初测，第2级压力 0.52 偏离设定 0.60 达 13.3% → 待复核
  {
    id: "T-1801",
    holeId: "ZK-18",
    top: 11.4,
    bottom: 16.4,
    createdAt: "2026-09-22T09:12:00",
    rounds: [
      {
        id: "T-1801-R1",
        kind: "initial",
        at: "2026-09-22T09:12:00",
        pipeLoss: 0.02,
        stages: [
          { setPressure: 0.3, pressure: 0.3, flow: 1.4, minutes: 20 },
          { setPressure: 0.6, pressure: 0.52, flow: 2.5, minutes: 20 },
          { setPressure: 1.0, pressure: 1.0, flow: 4.1, minutes: 20 },
        ],
      },
    ],
  },
  // ZK-21：卵石层内单段，三级平稳，无命中 → 待负责人确认
  {
    id: "T-2101",
    holeId: "ZK-21",
    top: 9.6,
    bottom: 14.8,
    createdAt: "2026-09-22T14:05:00",
    rounds: [
      {
        id: "T-2101-R1",
        kind: "initial",
        at: "2026-09-22T14:05:00",
        pipeLoss: 0.03,
        stages: [
          { setPressure: 0.3, pressure: 0.3, flow: 2.2, minutes: 20 },
          { setPressure: 0.6, pressure: 0.6, flow: 4.4, minutes: 20 },
          { setPressure: 1.0, pressure: 1.0, flow: 7.3, minutes: 20 },
        ],
      },
    ],
  },
  // ZK-24：初测已冻结 v1，事后流量计校检更正第3级读数，补测后冻结 v2
  {
    id: "T-2401",
    holeId: "ZK-24",
    top: 6.2,
    bottom: 11.2,
    createdAt: "2026-09-22T11:20:00",
    rounds: [
      {
        id: "T-2401-R1",
        kind: "initial",
        at: "2026-09-22T11:20:00",
        pipeLoss: 0.025,
        stages: [
          { setPressure: 0.3, pressure: 0.3, flow: 1.9, minutes: 20 },
          { setPressure: 0.6, pressure: 0.6, flow: 3.8, minutes: 20 },
          { setPressure: 1.0, pressure: 1.0, flow: 6.2, minutes: 20 },
        ],
      },
      {
        id: "T-2401-R2",
        kind: "amend",
        at: "2026-09-25T10:40:00",
        pipeLoss: 0.025,
        stages: [
          { setPressure: 0.3, pressure: 0.3, flow: 1.9, minutes: 20 },
          { setPressure: 0.6, pressure: 0.6, flow: 3.8, minutes: 20 },
          { setPressure: 1.0, pressure: 1.0, flow: 6.6, minutes: 20 },
        ],
      },
    ],
  },
];

export const seedVerdicts: Record<string, Verdict> = {
  "T-1801": {
    testId: "T-1801",
    status: "pending_review",
    reasonText: {},
    versions: [],
    updatedAt: "2026-09-22T10:30:00",
  },
  "T-2101": {
    testId: "T-2101",
    status: "awaiting_confirm",
    reasonText: {},
    versions: [],
    updatedAt: "2026-09-22T15:00:00",
  },
  "T-2401": {
    testId: "T-2401",
    status: "confirmed",
    reasonText: {},
    versions: [
      {
        version: 1,
        createdAt: "2026-09-23T09:00:00",
        confirmer: "周景春",
        roundId: "T-2401-R1",
        qLu: 1.125,
        kSuggested: 0.0251,
        kConfirmed: 0.025,
      },
      {
        version: 2,
        createdAt: "2026-09-25T11:30:00",
        confirmer: "周景春",
        roundId: "T-2401-R2",
        qLu: 1.15,
        kSuggested: 0.0257,
        kConfirmed: 0.0257,
        changeReason:
          "流量计校检发现第3级稳定流量原抄录 6.2 偏小，更正为 6.6 L/min；按修订补测重新计算后冻结，v1 保留备查。",
      },
    ],
    updatedAt: "2026-09-25T11:30:00",
  },
};
