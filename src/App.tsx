import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import type { Hole, Round, TestRecord, Verdict } from "./types";
import { STATUS_LABEL } from "./types";
import { storage, exportStore } from "./storage";
import { seedHoles, seedTests, seedVerdicts } from "./seed";
import { collectReasons } from "./rules";
import { lugeon, round4, suggestedK } from "./hydraulics";
import { LayerStrip } from "./components/LayerStrip";
import { TestCard } from "./components/TestCard";

const nowIso = () => new Date().toISOString();
const newId = (p: string) => `${p}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

type LoadState = "loading" | "ready" | "error";

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [holes, setHoles] = useState<Hole[]>([]);
  const [testsByHole, setTestsByHole] = useState<Record<string, TestRecord[]>>({});
  const [verdictsByHole, setVerdictsByHole] = useState<Record<string, Record<string, Verdict>>>({});
  const [holeId, setHoleId] = useState<string>("");
  const [saveFlash, setSaveFlash] = useState("");

  // 启动：三层各自独立装载；资料库为空时仅写入示例资料，判定库为空时写入示例判定
  useEffect(() => {
    (async () => {
      try {
        let hs = await storage.loadHoles();
        if (!hs) {
          hs = seedHoles;
          await storage.saveHoles(hs);
        }
        const tbh: Record<string, TestRecord[]> = {};
        const vbh: Record<string, Record<string, Verdict>> = {};
        for (const h of hs) {
          let ts = await storage.loadTests(h.id);
          if (!ts) {
            ts = seedTests.filter((t) => t.holeId === h.id);
            await storage.saveTests(h.id, ts);
          }
          tbh[h.id] = ts;
          let vs = await storage.loadVerdicts(h.id);
          if (!vs) {
            vs = Object.fromEntries(
              ts.filter((t) => seedVerdicts[t.id]).map((t) => [t.id, seedVerdicts[t.id]])
            );
            await storage.saveVerdicts(h.id, vs);
          }
          vbh[h.id] = vs;
        }
        const last = await storage.getLastHole();
        setHoles(hs);
        setTestsByHole(tbh);
        setVerdictsByHole(vbh);
        setHoleId(last && hs.some((h) => h.id === last) ? last : hs[0]?.id ?? "");
        setLoadState("ready");
      } catch (e) {
        console.error(e);
        setLoadState("error");
      }
    })();
  }, []);

  const hole = holes.find((h) => h.id === holeId);
  const tests = hole ? testsByHole[hole.id] ?? [] : [];
  const verdicts = hole ? verdictsByHole[hole.id] ?? {} : {};

  const persistTests = async (h: Hole, next: TestRecord[]) => {
    setTestsByHole((m) => ({ ...m, [h.id]: next }));
    await storage.saveTests(h.id, next);
    flash("资料已写入本机资料库");
  };
  const persistVerdicts = async (h: Hole, next: Record<string, Verdict>) => {
    setVerdictsByHole((m) => ({ ...m, [h.id]: next }));
    await storage.saveVerdicts(h.id, next);
    flash("判定已写入本机判定库");
  };
  const flash = (msg: string) => {
    setSaveFlash(`${new Date().toLocaleTimeString("zh-CN")} · ${msg}`);
  };

  const pickHole = async (id: string) => {
    setHoleId(id);
    await storage.setLastHole(id);
  };

  const createTest = (top: number, bottom: number) => {
    if (!hole) return;
    const test: TestRecord = {
      id: newId("T"),
      holeId: hole.id,
      top,
      bottom,
      createdAt: nowIso(),
      rounds: [],
    };
    const verdict: Verdict = {
      testId: test.id,
      status: "pending_review",
      reasonText: {},
      versions: [],
      updatedAt: nowIso(),
    };
    persistTests(hole, [...tests, test]);
    persistVerdicts(hole, { ...verdicts, [test.id]: verdict });
  };

  const saveRound = (test: TestRecord, round: Round) => {
    if (!hole) return;
    const nextTests = tests.map((t) =>
      t.id === test.id ? { ...t, rounds: [...t.rounds, round] } : t
    );
    persistTests(hole, nextTests);

    // 保存读数本身不改判；初测无命中则自动送确认，命中则留待复核
    const v = verdicts[test.id];
    if (v && v.status === "pending_review") {
      const updated = { ...test, rounds: [...test.rounds, round] };
      const { byCode } = collectReasons(hole, updated);
      if (byCode.size === 0) {
        persistVerdicts(hole, {
          ...verdicts,
          [test.id]: { ...v, status: "awaiting_confirm", updatedAt: nowIso() },
        });
      }
    }
  };

  const resolveReview = (test: TestRecord, reasonText: Verdict["reasonText"]) => {
    const v = verdicts[test.id];
    if (!v || !hole) return;
    persistVerdicts(hole, {
      ...verdicts,
      [test.id]: { ...v, reasonText, status: "awaiting_confirm", updatedAt: nowIso() },
    });
  };

  const confirmResult = (test: TestRecord, confirmer: string, kConfirmed: number) => {
    if (!hole) return;
    const latest = test.rounds[test.rounds.length - 1];
    const v = verdicts[test.id];
    if (!v || !latest) return;
    const version = {
      version: v.versions.length + 1,
      createdAt: nowIso(),
      confirmer,
      roundId: latest.id,
      qLu: round4(lugeon(test, latest)),
      kSuggested: round4(suggestedK(hole, test, latest)),
      kConfirmed,
    };
    persistVerdicts(hole, {
      ...verdicts,
      [test.id]: {
        ...v,
        status: "confirmed",
        versions: [...v.versions, version],
        updatedAt: nowIso(),
      },
    });
  };

  const amendResult = (
    test: TestRecord,
    changeReason: string,
    round: Round,
    confirmer: string,
    kConfirmed: number
  ) => {
    if (!hole) return;
    const v = verdicts[test.id];
    if (!v) return;
    const updatedTest: TestRecord = { ...test, rounds: [...test.rounds, round] };
    persistTests(hole, tests.map((t) => (t.id === test.id ? updatedTest : t)));
    const version = {
      version: v.versions.length + 1,
      createdAt: nowIso(),
      confirmer,
      roundId: round.id,
      qLu: round4(lugeon(updatedTest, round)),
      kSuggested: round4(suggestedK(hole, updatedTest, round)),
      kConfirmed,
      changeReason,
    };
    persistVerdicts(hole, {
      ...verdicts,
      [test.id]: { ...v, status: "confirmed", versions: [...v.versions, version], updatedAt: nowIso() },
    });
  };

  const metrics = useMemo(() => {
    const all = holes.flatMap((h) =>
      (testsByHole[h.id] ?? []).map((t) => ({ h, t, v: verdictsByHole[h.id]?.[t.id] }))
    );
    return {
      holes: holes.length,
      tests: all.length,
      pending: all.filter((x) => x.v?.status === "pending_review").length,
      frozen: all.filter((x) => x.v?.status === "confirmed").length,
    };
  }, [holes, testsByHole, verdictsByHole]);

  if (loadState === "loading") {
    return <main className="app-shell"><p className="loading">正在从本机三个独立库装载资料与判定…</p></main>;
  }
  if (loadState === "error" || !hole) {
    return <main className="app-shell"><p className="loading">本机 IndexedDB 不可用，请更换支持离线存储的浏览器后重试。</p></main>;
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-03 · 压水试验复核台 · port 5103</p>
          <h1>压水试验复核台</h1>
          <p className="subtitle">
            每孔从连续分层圈定试段，登记试验压力、三级流量、各级时长与管路损失；
            跨层、压力偏离设定值超过一成、后两级折算流量差超过一成即留待复核，写明原因并复测后方可送确认。
            负责人确认渗透系数后结果冻结，事后改值另留原因版本。
          </p>
        </div>
        <div className="stack-card">
          <span>数据分层（本机 IndexedDB，三库物理分开）</span>
          <strong>资料库 · 判定库 · 本机设置库</strong>
          <small>资料只追加不改写；判定独立冻结；重开按孔号回到上次工作位置</small>
        </div>
      </section>

      <section className="metrics-grid">
        <article className="metric-card"><span>钻孔数</span><strong>{metrics.holes}</strong><i className="status-ok" /></article>
        <article className="metric-card"><span>已登记试段</span><strong>{metrics.tests}</strong><i className="status-watch" /></article>
        <article className="metric-card"><span>待复核试段</span><strong>{metrics.pending}</strong><i className="status-danger" /></article>
        <article className="metric-card"><span>已冻结结果</span><strong>{metrics.frozen}</strong><i className="status-ok" /></article>
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>孔号（按孔接续）</h2>
          <div className="hole-list">
            {holes.map((h) => {
              const hs = testsByHole[h.id] ?? [];
              const hv = verdictsByHole[h.id] ?? {};
              const pending = hs.filter((t) => hv[t.id]?.status === "pending_review").length;
              const confirmed = hs.filter((t) => hv[t.id]?.status === "confirmed").length;
              return (
                <button
                  key={h.id}
                  className={"hole-item" + (h.id === holeId ? " active" : "")}
                  onClick={() => pickHole(h.id)}
                >
                  <strong>{h.id}</strong>
                  <span>孔深 {h.depth}m · {h.layers.length} 层</span>
                  <span className="hole-counts">
                    {pending > 0 && <em className="dot-danger">待复核 {pending}</em>}
                    {confirmed > 0 && <em className="dot-ok">已确认 {confirmed}</em>}
                    {pending === 0 && confirmed === 0 && <em className="dot-muted">无试段记录</em>}
                  </span>
                </button>
              );
            })}
          </div>

          <h2>导出（资料 / 判定分开）</h2>
          <div className="export-row">
            <button
              onClick={async () =>
                download(`${hole.id}-资料.json`, await exportStore("raw", hole.id))
              }
            >
              导出本孔资料
            </button>
            <button
              onClick={async () =>
                download(`${hole.id}-判定.json`, await exportStore("verdict", hole.id))
              }
            >
              导出本孔判定
            </button>
          </div>
          <p className="save-flash">{saveFlash || "所有保存均在本机完成，不上传服务器"}</p>
        </aside>

        <section className="main-col">
          <LayerStrip hole={hole} tests={tests} onCreate={createTest} />

          <div className="test-list">
            {tests.length === 0 && (
              <section className="panel empty-hint">
                该孔尚无试段：在上方连续分层条上选择顶界、底界后圈定试段。
              </section>
            )}
            {tests.map((t) => {
              const v = verdicts[t.id];
              if (!v) return null;
              return (
                <TestCard
                  key={t.id}
                  hole={hole}
                  test={t}
                  verdict={v}
                  onSaveRound={(r) => saveRound(t, r)}
                  onResolve={(rt) => resolveReview(t, rt)}
                  onConfirm={(c, k) => confirmResult(t, c, k)}
                  onAmend={(reason, r, c, k) => amendResult(t, reason, r, c, k)}
                />
              );
            })}
          </div>

          <section className="panel legend">
            <p className="subsection-title">判定规则与状态说明</p>
            <ul>
              <li><strong>试段跨层</strong>：分层界线落在试段内部即命中，需写跨层取值说明并复测。</li>
              <li><strong>压力偏离</strong>：任一级实测表压与设定值之差超过 10% 即命中。</li>
              <li><strong>流量稳定性</strong>：比较后两级折算透水率 q=Q/(P·L)，差异超过 10% 即命中（原始流量随压力变化，不直接可比）。</li>
              <li>有效压力 = 实测表压 − 管路损失 + 试段中点水柱压力；透水率 q=Q/(P·L)，建议 k 按 Hvorslev 栓塞段公式给出，最终以负责人确认值为准。</li>
              <li>状态流转：{STATUS_LABEL.pending_review} → {STATUS_LABEL.awaiting_confirm} → {STATUS_LABEL.confirmed}；冻结值只读，改值须填原因并另存新版本，历史版本保留。</li>
            </ul>
          </section>
        </section>
      </section>
    </main>
  );
}
