import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import type {
  Borehole,
  KUnit,
  TestRegistration,
  Verdict,
  VerdictStatus,
} from "./types";
import {
  loadData,
  saveData,
  loadVerdicts,
  saveVerdicts,
  loadUi,
  saveUi,
  newId,
  type DataStore,
} from "./storage";
import { evaluate, calcLu, nextVersion } from "./rules";
import RegistrationForm, {
  emptyForm,
  formToReg,
  regToForm,
  type FormState,
} from "./RegistrationForm";
import RecordDetail from "./RecordDetail";

type Tab = "pending" | "qualified" | "frozen" | "all";

const TABS: { key: Tab; label: string }[] = [
  { key: "pending", label: "待复核" },
  { key: "qualified", label: "待确认K" },
  { key: "frozen", label: "已确认冻结" },
  { key: "all", label: "全部" },
];

export default function App() {
  const [data, setData] = useState<DataStore>(() => loadData());
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>(() =>
    loadVerdicts()
  );
  const initialUi = useMemo(() => {
    const ui = loadUi();
    return {
      ...ui,
      // 上次打开的孔号若已不存在则回退到第一个
      currentHoleId: loadData().boreholes.some((b) => b.holeId === ui.currentHoleId)
        ? ui.currentHoleId
        : loadData().boreholes[0]?.holeId ?? "",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [currentHoleId, setCurrentHoleId] = useState(initialUi.currentHoleId);
  const [tab, setTab] = useState<Tab>(initialUi.tab);

  const [form, setForm] = useState<FormState | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // 三层分别落盘：资料 / 判定 / 本机状态
  useEffect(() => saveData(data), [data]);
  useEffect(() => saveVerdicts(verdicts), [verdicts]);
  useEffect(() => saveUi({ currentHoleId, tab }), [currentHoleId, tab]);

  const hole = data.boreholes.find((b) => b.holeId === currentHoleId);

  const statusOf = (reg: TestRegistration): VerdictStatus =>
    verdicts[reg.id]?.status ?? "draft";

  // 一条登记是否已被复测记录替代
  const effectiveSuperseded = (reg: TestRegistration): boolean => {
    const v = verdicts[reg.id];
    if (v?.status === "superseded") return true;
    return data.registrations.some(
      (r) => r.retestOf === reg.id && verdicts[r.id]?.status !== "superseded"
    );
  };

  const holeRegs = useMemo(
    () =>
      data.registrations
        .filter((r) => r.holeId === currentHoleId)
        .sort((a, b) => a.id.localeCompare(b.id)),
    [data.registrations, currentHoleId]
  );

  const visibleRegs = holeRegs.filter((r) => {
    const sup = effectiveSuperseded(r);
    if (tab === "all") return true;
    if (tab === "frozen") return statusOf(r) === "frozen" && !sup;
    if (tab === "qualified") return statusOf(r) === "qualified" && !sup;
    if (tab === "pending") {
      // 待复核：已提交且判 pending（未被替代），外加还没提交的草稿
      return (!sup && statusOf(r) === "pending") || statusOf(r) === "draft";
    }
    return true;
  });

  const counts = useMemo(() => {
    const c = { pending: 0, qualified: 0, frozen: 0 };
    for (const r of holeRegs) {
      if (effectiveSuperseded(r)) continue;
      const s = statusOf(r);
      if (s === "pending" || s === "draft") c.pending++;
      else if (s === "qualified") c.qualified++;
      else if (s === "frozen") c.frozen++;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeRegs, verdicts]);

  // ---------- 登记保存：asDraft 只进资料层；否则按规则判定 ----------
  const saveRegistration = (f: FormState, asDraft: boolean) => {
    const reg = formToReg(f);
    setData((d) => {
      const exists = d.registrations.some((r) => r.id === reg.id);
      return {
        ...d,
        registrations: exists
          ? d.registrations.map((r) => (r.id === reg.id ? reg : r))
          : [...d.registrations, reg],
        seq: Math.max(d.seq, Number(reg.id.split("-")[1]) + 1 || d.seq),
      };
    });

    if (!asDraft) {
      const res = evaluate(reg, hole);
      const willPending = res.issues.length > 0;
      setVerdicts((v) => {
        const prev = v[reg.id];
        const next: Verdict = {
          regId: reg.id,
          status: willPending ? "pending" : "qualified",
          // 自动把问题写入原因；已有人工说明则保留，问题清单仍在详情中可见
          note:
            prev?.note ||
            (res.issues.length
              ? res.issues.map((i) => `【${i.label}】${i.detail}`).join("\n")
              : ""),
          submittedAt: new Date().toISOString(),
          submittedBy: reg.operator || prev?.submittedBy,
          versions: prev?.versions ?? [],
          retestIds: prev?.retestIds ?? [],
          updatedAt: new Date().toISOString(),
        };
        return { ...v, [reg.id]: next };
      });
    }
    setForm(null);
  };

  const startNew = () =>
    setForm(emptyForm(newId(data.seq), currentHoleId));

  const editDraft = (reg: TestRegistration) => setForm(regToForm(reg));

  // 待复核记录可更正纸上抄录（仍为同一记录编号），保存后重新判定；
  // 真正的现场异常则走“登记复测”另起记录。
  const correctTranscript = (reg: TestRegistration) => {
    setForm(regToForm(reg));
    setOpenId(null);
  };

  // ---------- 待复核操作 ----------
  const saveNote = (regId: string, note: string) =>
    setVerdicts((v) => ({
      ...v,
      [regId]: {
        ...(v[regId] ?? blankVerdict(regId)),
        note,
        updatedAt: new Date().toISOString(),
      },
    }));

  // 复测：用原资料预填一条新登记；新记录通过后自动把原记录标记为已替代
  const createRetest = (src: TestRegistration) => {
    const f = emptyForm(newId(data.seq), src.holeId);
    f.segmentTop = src.segmentTop;
    f.segmentBottom = src.segmentBottom;
    f.setPressure = src.setPressure;
    f.pipeLoss = src.pipeLoss;
    f.operator = src.operator;
    f.retestOf = src.id; // 直接指向被复测记录，替代链可逐级回溯
    setForm(f);
    setOpenId(null);
  };

  // 当复测记录走到 qualified/frozen，把其原记录标 superseded
  useEffect(() => {
    setVerdicts((v) => {
      let changed = false;
      const next = { ...v };
      for (const r of data.registrations) {
        if (!r.retestOf) continue;
        const sv = next[r.id];
        if (!sv || sv.status === "pending" || sv.status === "draft") continue;
        const av = next[r.retestOf];
        if (av && av.status !== "superseded") {
          next[r.retestOf] = {
            ...av,
            status: "superseded",
            supersededById: r.id,
            updatedAt: new Date().toISOString(),
          };
          changed = true;
        }
      }
      return changed ? next : v;
    });
  }, [data.registrations, verdicts]);

  // ---------- 负责人确认 K：冻结资料快照 + 结果 ----------
  const confirmK = (
    reg: TestRegistration,
    value: string,
    unit: KUnit,
    name: string
  ) => {
    const lu = calcLu(reg);
    setVerdicts((v) => {
      const prev = v[reg.id] ?? blankVerdict(reg.id);
      const version = nextVersion(
        prev.versions,
        reg,
        { value, unit },
        lu === null ? null : lu.toFixed(2),
        name
      );
      return {
        ...v,
        [reg.id]: {
          ...prev,
          status: "frozen",
          confirmedBy: name,
          confirmedAt: version.confirmedAt,
          k: { value, unit },
          versions: [...prev.versions, version],
          updatedAt: new Date().toISOString(),
        },
      };
    });
    setOpenId(null);
  };

  // 事后改值：原值版本保留，另存带原因的新版本
  const reviseK = (
    reg: TestRegistration,
    value: string,
    unit: KUnit,
    name: string,
    reason: string
  ) => {
    const lu = calcLu(reg);
    setVerdicts((v) => {
      const prev = v[reg.id];
      if (!prev) return v;
      const version = nextVersion(
        prev.versions,
        reg,
        { value, unit },
        lu === null ? null : lu.toFixed(2),
        name,
        reason
      );
      return {
        ...v,
        [reg.id]: {
          ...prev,
          confirmedBy: name,
          confirmedAt: version.confirmedAt,
          k: { value, unit },
          versions: [...prev.versions, version],
          updatedAt: new Date().toISOString(),
        },
      };
    });
    setOpenId(null);
  };

  const deleteDraft = (regId: string) => {
    setData((d) => ({
      ...d,
      registrations: d.registrations.filter((r) => r.id !== regId),
    }));
    setVerdicts((v) => {
      if (!v[regId]) return v;
      const n = { ...v };
      delete n[regId];
      return n;
    });
    setOpenId(null);
  };

  const openReg = openId
    ? data.registrations.find((r) => r.id === openId)
    : null;

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-03 · 压水试验复核台</p>
          <h1>压水试验复核台</h1>
          <p className="subtitle">
            每孔从连续分层中选试段，登记试验压力、三级流量、各级时长与管路损失；
            跨层、压力偏离设定值或后两级流量差超过一成即留待复核，写明原因并复测通过后才放行。
            负责人确认渗透系数即冻结，改值另留原因版本。资料、判定、本机保存分开存储。
          </p>
        </div>
        <div className="stack-card">
          <span>分层存储</span>
          <strong>资料（分层/登记）· 判定（复核/冻结版本）· 本机（孔号/筛选）</strong>
        </div>
      </section>

      <section className="metrics-grid">
        <article className="metric-card">
          <span>当前孔待复核</span>
          <strong>{counts.pending}</strong>
          <i className="status-danger" />
        </article>
        <article className="metric-card">
          <span>待负责人确认K</span>
          <strong>{counts.qualified}</strong>
          <i className="status-watch" />
        </article>
        <article className="metric-card">
          <span>已冻结成果</span>
          <strong>{counts.frozen}</strong>
          <i className="status-ok" />
        </article>
        <article className="metric-card">
          <span>本孔试段总数</span>
          <strong>{holeRegs.length}</strong>
          <i className="status-ok" />
        </article>
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>钻孔（按孔号接续）</h2>
          <div className="hole-list">
            {data.boreholes.map((b) => {
              const pending = data.registrations.filter(
                (r) =>
                  r.holeId === b.holeId &&
                  (verdicts[r.id]?.status === "pending" ||
                    verdicts[r.id]?.status === "draft")
              ).length;
              return (
                <button
                  key={b.holeId}
                  className={"hole-item" + (b.holeId === currentHoleId ? " active" : "")}
                  onClick={() => setCurrentHoleId(b.holeId)}
                >
                  <b>{b.holeId}</b>
                  <span>孔深 {b.totalDepth}m · {b.layers.length} 层</span>
                  {pending > 0 && <em className="hole-badge">{pending}</em>}
                </button>
              );
            })}
          </div>
        </aside>

        <section className="panel">
          {hole && <LayerStrip hole={hole} regs={holeRegs} verdicts={verdicts} />}

          <div className="section-heading">
            <div>
              <p>{currentHoleId} · 压水试段</p>
              <h2>试验登记与复核</h2>
            </div>
            {!form && (
              <button className="primary-action" onClick={startNew}>
                + 从分层选试段登记
              </button>
            )}
          </div>

          {form ? (
            <RegistrationForm
              form={form}
              hole={hole}
              onChange={setForm}
              onSave={(asDraft) => saveRegistration(form, asDraft)}
              onCancel={() => setForm(null)}
              submitLabel={form.retestOf ? "保存复测并提交判定" : "保存并提交判定"}
            />
          ) : (
            <>
              <div className="tab-row">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    className={"tab" + (tab === t.key ? " active" : "")}
                    onClick={() => setTab(t.key)}
                  >
                    {t.label}
                    {t.key !== "all" && (
                      <span className="tab-count">{counts[t.key]}</span>
                    )}
                  </button>
                ))}
              </div>

              {visibleRegs.length === 0 ? (
                <p className="empty-line">该分类下暂无记录。重开页面仍按孔号 {currentHoleId} 接续。</p>
              ) : (
                <div className="record-list">
                  {visibleRegs.map((reg) => (
                    <RecordRow
                      key={reg.id}
                      reg={reg}
                      hole={hole}
                      status={statusOf(reg)}
                      superseded={effectiveSuperseded(reg)}
                      verdict={verdicts[reg.id]}
                      onOpen={() => setOpenId(reg.id)}
                      onEditDraft={() => editDraft(reg)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </section>

      {openReg && (
        <RecordDetail
          reg={openReg}
          hole={hole}
          verdict={verdicts[openReg.id]}
          onClose={() => setOpenId(null)}
          onSaveNote={(note) => saveNote(openReg.id, note)}
          onRetest={() => createRetest(openReg)}
          onCorrect={() => correctTranscript(openReg)}
          onConfirmK={(val, u, name) => confirmK(openReg, val, u, name)}
          onReviseK={(val, u, name, reason) => reviseK(openReg, val, u, name, reason)}
          onDeleteDraft={() => deleteDraft(openReg.id)}
        />
      )}
    </main>
  );
}

function blankVerdict(regId: string): Verdict {
  return {
    regId,
    status: "draft",
    note: "",
    versions: [],
    retestIds: [],
    updatedAt: new Date().toISOString(),
  };
}

// ---------- 连续分层条：标注各试段落点，直观看到是否跨层 ----------
function LayerStrip({
  hole,
  regs,
  verdicts,
}: {
  hole: Borehole;
  regs: TestRegistration[];
  verdicts: Record<string, Verdict>;
}) {
  return (
    <div className="layer-strip">
      <p className="strip-title">
        {hole.holeId} 连续分层（孔深 {hole.totalDepth}m
        {hole.waterLevel !== null && `，水位 ${hole.waterLevel}m`}）
      </p>
      <div className="layer-bars">
        {hole.layers.map((l) => {
          const thick = l.bottom - l.top;
          return (
            <div
              key={l.top}
              className="layer-bar"
              style={{ flexGrow: thick, flexBasis: 0 }}
              title={`${l.name} ${l.top}~${l.bottom}m`}
            >
              <b>{l.name}</b>
              <small>
                {l.top}~{l.bottom}m
              </small>
              <div className="seg-marks">
                {regs
                  .filter((r) => {
                    const t = Number(r.segmentTop);
                    const b = Number(r.segmentBottom);
                    return Number.isFinite(t) && Number.isFinite(b) && b > t &&
                      b > l.top && t < l.bottom;
                  })
                  .map((r) => {
                    const t = Math.max(Number(r.segmentTop), l.top);
                    const b = Math.min(Number(r.segmentBottom), l.bottom);
                    const left = ((t - l.top) / thick) * 100;
                    const width = ((b - t) / thick) * 100;
                    const st = verdicts[r.id]?.status ?? "draft";
                    return (
                      <span
                        key={r.id}
                        className={"seg-mark st-" + st}
                        style={{ left: left + "%", width: Math.max(width, 4) + "%" }}
                        title={`${r.id} ${r.segmentTop}~${r.segmentBottom}m`}
                      />
                    );
                  })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecordRow({
  reg,
  hole,
  status,
  superseded,
  verdict,
  onOpen,
  onEditDraft,
}: {
  reg: TestRegistration;
  hole: Borehole | undefined;
  status: VerdictStatus;
  superseded: boolean;
  verdict: Verdict | undefined;
  onOpen: () => void;
  onEditDraft: () => void;
}) {
  const res = evaluate(reg, hole);
  const hard = res.issues.filter((i) => i.code !== "INCOMPLETE");
  const shownStatus: VerdictStatus = superseded ? "superseded" : status;
  const frozen = verdict?.versions[verdict.versions.length - 1];
  const lu = calcLu(reg);

  return (
    <article className={"record-card seg-row st-" + shownStatus}>
      <div className="record-index">{reg.id.split("-")[1]}</div>
      <div className="seg-main">
        <h3>
          {reg.segmentTop || "?"}~{reg.segmentBottom || "?"}m
          <span className={"status-pill st-" + shownStatus}>
            {statusText(shownStatus)}
          </span>
          {reg.retestOf && <span className="retest-tag">复测</span>}
        </h3>
        <p className="seg-meta">
          {res.metrics.spanned.map((l) => l.name).join("、") || "深度待填"} · 设定{" "}
          {reg.setPressure}MPa · 损失 {reg.pipeLoss || "—"}MPa
          {lu !== null && ` · ${lu.toFixed(2)}Lu`}
          {frozen && (
            <b className="k-tag">
              K={frozen.k.value} {frozen.k.unit}（v{frozen.version}）
            </b>
          )}
        </p>
        {shownStatus === "pending" && hard.length > 0 && (
          <p className="seg-issues">
            {hard.map((i) => (
              <span key={i.code} className="mini-issue">
                {i.label}
              </span>
            ))}
          </p>
        )}
        {verdict?.note && shownStatus !== "superseded" && (
          <p className="seg-note">原因：{verdict.note.split("\n")[0]}</p>
        )}
      </div>
      <div className="seg-actions">
        <button onClick={onOpen}>复核详情</button>
        {shownStatus === "draft" && (
          <button className="primary-action" onClick={onEditDraft}>
            继续填写
          </button>
        )}
      </div>
    </article>
  );
}

function statusText(s: VerdictStatus): string {
  return {
    draft: "草稿",
    pending: "待复核",
    qualified: "待确认K",
    frozen: "已冻结",
    superseded: "已复测替代",
  }[s];
}
