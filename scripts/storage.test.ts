import "fake-indexeddb/auto";
import assert from "node:assert";
import { storage, exportStore } from "../src/storage";
import type { Hole, TestRecord, Verdict } from "../src/types";

const hole: Hole = {
  id: "ZK-T",
  depth: 10,
  radius: 0.0375,
  layers: [{ id: "a", top: 0, bottom: 10, lithology: "砂岩", state: "完整" }],
};
const test: TestRecord = {
  id: "T-1",
  holeId: "ZK-T",
  top: 0,
  bottom: 10,
  createdAt: "2026-09-26T00:00:00",
  rounds: [],
};
const verdict: Verdict = {
  testId: "T-1",
  status: "confirmed",
  reasonText: {},
  versions: [
    {
      version: 1,
      createdAt: "2026-09-26T01:00:00",
      confirmer: "测试负责人",
      roundId: "R1",
      qLu: 1.2,
      kSuggested: 0.026,
      kConfirmed: 0.0258,
    },
  ],
  updatedAt: "2026-09-26T01:00:00",
};

// 模拟一次会话：三层分别保存
await storage.saveHoles([hole]);
await storage.saveTests("ZK-T", [test]);
await storage.saveVerdicts("ZK-T", { "T-1": verdict });
await storage.setLastHole("ZK-T");

// 模拟重开：各自独立读回
assert.deepStrictEqual(await storage.loadHoles(), [hole], "资料-钻孔");
assert.deepStrictEqual(await storage.loadTests("ZK-T"), [test], "资料-试段");
assert.deepStrictEqual(await storage.loadVerdicts("ZK-T"), { "T-1": verdict }, "判定");
assert.strictEqual(await storage.getLastHole(), "ZK-T", "本机设置-孔号");

// 判定库改动不影响资料，反之亦然
await storage.saveVerdicts("ZK-T", {
  "T-1": { ...verdict, status: "pending_review" },
});
assert.deepStrictEqual(await storage.loadTests("ZK-T"), [test], "改判定后资料不变");

// 导出分开
const raw = JSON.parse(await exportStore("raw", "ZK-T"));
const ver = JSON.parse(await exportStore("verdict", "ZK-T"));
assert.strictEqual(raw.kind, "资料");
assert.strictEqual(ver.kind, "判定");
assert.ok(raw.tests["ZK-T"], "资料导出含试段");
assert.ok(ver.verdicts["ZK-T"]["T-1"], "判定导出含结论");
assert.ok(!("verdicts" in raw), "资料导出不含判定");
assert.ok(!("tests" in ver), "判定导出不含资料");

console.log("✓ 三库独立持久化、重开接续、资料/判定导出分离 全部通过");
