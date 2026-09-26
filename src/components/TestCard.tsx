import { useMemo, useState } from "react";
import type {
  Flag,
  Hole,
  Round,
  RoundKind,
  Stage,
  TestRecord,
  Verdict,
} from "../types";
import { ROUND_LABEL, STATUS_LABEL } from "../types";
import {
  REASON_LABEL,
  ReasonCode,
  canResolveReview,
  collectReasons,
  evaluateRound,
  midDepth,
  waterColumn,
} from "../rules";
import { lugeon, round4, suggestedK } from "../hydraulics";
import { Badge, NumberField, SectionTitle } from "./ui";

const DEFAULT_SET = [0.3, 0.6, 1.0];
const blankRound = (kind: RoundKind): Round => ({
  id: `R-${Date.now()}`,
  kind,
  at: new Date().toISOString(),
  pipeLoss: NaN,
  stages: DEFAULT_SET.map((p) => ({
    setPressure: p,
    pressure: NaN,
    flow: NaN,
    minutes: NaN,
  })) as [Stage, Stage, Stage],
});

const statusTone = (s: Verdict["status"]) =>
  s === "confirmed" ? "ok" : s === "awaiting_confirm" ? "warn" : "danger";

function FlagList({ flags }: { flags: Flag[] }) {
  if (flags.length === 0)
    return <p className="text-ok rule-line">✓ 三级压力、流量规则全部通过，无待复核项</p>;
  return (
    <ul className="flag-list">
      {flags.map((f, i) => (
        <li key={i} className={"flag-" + f.code}>
          <Badge tone={f.code === "INCOMPLETE" ? "muted" : "danger"}>待复核</Badge>
          {f.detail}
        </li>
      ))}
    </ul>
  );
}

export function TestCard({
  hole,
  test,
  verdict,
  onSaveRound,
  onResolve,
  onConfirm,
  onAmend,
}: {
  hole: Hole;
  test: TestRecord;
  verdict: Verdict;
  onSaveRound: (round: Round) => void;
  onResolve: (reasonText: Verdict["reasonText"]) => void;
  onConfirm: (confirmer: string, kConfirmed: number) => void;
  onAmend: (changeReason: string, round: Round, confirmer: string, kConfirmed: number) => void;
}) {
  const [adding, setAdding] = useState<RoundKind | null>(null);
  const [draft, setDraft] = useState<Round | null>(null);
  const [reasons, setReasons] = useState<Verdict["reasonText"]>(verdict.reasonText);
  const [confirmer, setConfirmer] = useState("");
  const [confirmedK, setConfirmedK] = useState<number>(NaN);
  const [changeReason, setChangeReason] = useState("");
  const [amendK, setAmendK] = useState<number>(NaN);

  const { flags: allFlags, byCode } = useMemo(
    () => collectReasons(hole, test),
    [hole, test]
  );
  const latest = test.rounds[test.rounds.length - 1];
  const liveRound = draft ?? latest;
  const liveEval = liveRound
    ? evaluateRound(hole, test, liveRound)
    : { flags: [], effective: [0, 0, 0], unitRates: [0, 0, 0] } as ReturnType<typeof evaluateRound>;

  const startAdd = (kind: RoundKind) => {
    const r = blankRound(kind);
    setAdding(kind);
    setDraft(r);
  };
  const cancelAdd = () => {
    setAdding(null);
    setDraft(null);
  };

  const setStage = (i: number, patch: Partial<Stage>) => {
    if (!draft) return;
    const stages = draft.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) as Round["stages"];
    setDraft({ ...draft, stages });
  };

  const draftComplete = draft
    ? !draft.stages.some((s) => !s.pressure || !s.flow || !s.minutes) &&
      !(draft.pipeLoss === undefined || Number.isNaN(draft.pipeLoss))
    : false;

  const saveDraft = () => {
    if (!draft || !draftComplete) return;
    onSaveRound({ ...draft, at: new Date().toISOString() });
    cancelAdd();
  };

  const resolveCheck = canResolveReview(hole, test, reasons);

  const qLatest = latest ? round4(lugeon(test, latest)) : NaN;
  const kLatest = latest ? round4(suggestedK(hole, test, latest)) : NaN;
  const kInput = Number.isNaN(confirmedK) ? kLatest : confirmedK;

  const frozen = verdict.status === "confirmed";
  const wc = waterColumn(midDepth(test));

  const startAmend = () => {
    const r = blankRound("amend");
    r.pipeLoss = latest?.pipeLoss ?? NaN;
    r.stages = (latest?.stages.map((s) => ({ ...s })) ?? r.stages) as Round["stages"];
    setAdding("amend");
    setDraft(r);
    setAmendK(NaN);
  };

  const amendLiveK = draft ? round4(suggestedK(hole, test, draft)) : NaN;
  const amendInputK = Number.isNaN(amendK) ? amendLiveK : amendK;
  const amendReady =
    draft &&
    changeReason.trim().length >= 5 &&
    confirmer.trim().length >= 2 &&
    !evaluateRound(hole, test, draft).flags.some(
      (f) => f.code === "PRESSURE_DEV" || f.code === "FLOW_DIFF" || f.code === "INCOMPLETE"
    );

  return (
    <article className={"panel test-card status-" + verdict.status}>
      <SectionTitle
        index={test.id}
        title={`试段 ${test.top}–${test.bottom}m · 段长 ${(test.bottom - test.top).toFixed(1)}m`}
        extra={
          <span className={`status-pill tone-${statusTone(verdict.status)}`}>
            {STATUS_LABEL[verdict.status]}
          </span>
        }
      />

      {/* 1. 资料区：各测次读数 */}
      <div className="rounds">
        {test.rounds.map((r, i) => (
          <RoundView key={r.id} hole={hole} test={test} round={r} highlight={i === test.rounds.length - 1} frozen={frozen} />
        ))}
        {test.rounds.length === 0 && <p className="hint-text">尚无测次，请登记初测三级读数。</p>}
      </div>

      {adding && draft && (
        <div className="draft-box">
          <div className="draft-head">
            <strong>{ROUND_LABEL[adding]}读数登记</strong>
            <span className="hint-text">
              中点 {(midDepth(test)).toFixed(1)}m，水柱压力 +{wc.toFixed(4)} MPa（自动计入有效压力）
            </span>
          </div>
          <div className="pipe-row">
            <NumberField
              label="管路压力损失"
              unit="MPa"
              step={0.005}
              value={draft.pipeLoss}
              onChange={(v) => setDraft({ ...draft, pipeLoss: v })}
            />
          </div>
          <div className="stage-grid">
            {draft.stages.map((s, i) => (
              <div key={i} className="stage-col">
                <p className="stage-title">第 {i + 1} 级</p>
                <NumberField label="设定表压" unit="MPa" step={0.05} value={s.setPressure}
                  onChange={(v) => setStage(i, { setPressure: v })} />
                <NumberField label="实测表压" unit="MPa" step={0.01} value={s.pressure}
                  onChange={(v) => setStage(i, { pressure: v })}
                  invalid={
                    Number.isFinite(s.pressure) &&
                    s.setPressure > 0 &&
                    Math.abs(s.pressure - s.setPressure) / s.setPressure > 0.1
                  }
                  hint={
                    Number.isFinite(s.pressure) && s.setPressure > 0
                      ? `偏离 ${(((s.pressure - s.setPressure) / s.setPressure) * 100).toFixed(1)}%`
                      : undefined
                  }
                />
                <NumberField label="稳定流量" unit="L/min" step={0.1} value={s.flow}
                  onChange={(v) => setStage(i, { flow: v })} />
                <NumberField label="本级时长" unit="min" step={1} value={s.minutes}
                  onChange={(v) => setStage(i, { minutes: v })} />
                {Number.isFinite(liveEval.effective[i]) && liveEval.effective[i] > 0 && (
                  <small className="eff">
                    有效压力 {liveEval.effective[i].toFixed(3)} MPa · 折算 {liveEval.unitRates[i].toFixed(2)} Lu
                  </small>
                )}
              </div>
            ))}
          </div>
          <FlagList flags={evaluateRound(hole, test, draft).flags.filter((f) => f.code !== "CROSS_LAYER")} />
          <div className="row-actions">
            <button onClick={cancelAdd}>取消</button>
            <button className="primary-action" disabled={!draftComplete} onClick={saveDraft}>
              保存{ROUND_LABEL[adding]}（资料只追加，不改写原读数）
            </button>
            {!draftComplete && <span className="hint-text">管路损失与三级读数、时长须全部填正数</span>}
          </div>
        </div>
      )}

      {/* 2. 判定区 */}
      {!frozen && (
        <div className="verdict-box">
          <div className="subsection">
            <p className="subsection-title">规则命中（跨层 / 压力 / 后两级流量，阈值一成）</p>
            <FlagList
              flags={allFlags.filter((f, i, arr) =>
                arr.findIndex((x) => x.detail === f.detail) === i
              )}
            />
          </div>

          {verdict.status === "pending_review" && (
            <>
              <div className="subsection">
                <p className="subsection-title">写明原因并复测后才能放行</p>
                <div className="reason-grid">
                  {(["CROSS_LAYER", "PRESSURE_DEV", "FLOW_DIFF"] as ReasonCode[])
                    .filter((c) => byCode.has(c))
                    .map((c) => (
                      <label key={c} className="reason-field">
                        <span>{REASON_LABEL[c]} *</span>
                        <textarea
                          rows={2}
                          value={reasons[c] ?? ""}
                          onChange={(e) => setReasons({ ...reasons, [c]: e.target.value })}
                          placeholder={c === "CROSS_LAYER" ? "如：以主导岩层取值，上下层渗漏性差异已在备注说明…" : "说明现场原因及处理…"}
                        />
                      </label>
                    ))}
                </div>
              </div>

              <div className="row-actions">
                {!adding && (
                  <button onClick={() => startAdd("retest")}>登记复测三级读数</button>
                )}
                <button
                  className="primary-action"
                  disabled={!resolveCheck.ok || adding !== null}
                  onClick={() => onResolve(reasons)}
                >
                  原因齐全、复测通过，送负责人确认
                </button>
                {!resolveCheck.ok && (
                  <span className="hint-text">尚缺：{resolveCheck.missing.join("、")}</span>
                )}
              </div>
            </>
          )}

          {verdict.status === "awaiting_confirm" && latest && (
            <div className="subsection confirm-box">
              <p className="subsection-title">负责人确认渗透系数（确认后即冻结）</p>
              <div className="confirm-values">
                <div>
                  <span>依据测次</span>
                  <strong>{ROUND_LABEL[latest.kind]} · {latest.id}</strong>
                </div>
                <div>
                  <span>透水率</span>
                  <strong>{qLatest} Lu</strong>
                </div>
                <div>
                  <span>解析解建议 k</span>
                  <strong>{kLatest} m/d</strong>
                </div>
              </div>
              <div className="confirm-form">
                <label className="reason-field grow">
                  <span>确认渗透系数 k（m/d）*</span>
                  <input
                    type="number"
                    step={0.0001}
                    value={Number.isFinite(kInput) ? String(kInput) : ""}
                    placeholder={String(kLatest)}
                    onChange={(e) => setConfirmedK(e.target.value === "" ? NaN : Number(e.target.value))}
                  />
                </label>
                <label className="reason-field grow">
                  <span>负责人签名 *</span>
                  <input value={confirmer} onChange={(e) => setConfirmer(e.target.value)} placeholder="姓名" />
                </label>
              </div>
              <div className="row-actions">
                <button
                  className="primary-action"
                  disabled={confirmer.trim().length < 2 || !Number.isFinite(kInput) || kInput <= 0}
                  onClick={() => onConfirm(confirmer.trim(), kInput)}
                >
                  确认并冻结结果
                </button>
                <span className="hint-text">冻结后只读；确需修改须填写改值原因并另存新版本</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. 冻结区：版本链 + 事后修订 */}
      {frozen && (
        <div className="frozen-box">
          <div className="versions">
            {verdict.versions.map((v) => (
              <div key={v.version} className={"version-row" + (v.version === verdict.versions.length ? " latest" : "")}>
                <div className="version-head">
                  <Badge tone={v.version === verdict.versions.length ? "ok" : "muted"}>v{v.version}</Badge>
                  <span>{new Date(v.createdAt).toLocaleString("zh-CN")}</span>
                  <span>负责人：{v.confirmer}</span>
                  {v.version === verdict.versions.length && <Badge tone="ok">当前生效</Badge>}
                </div>
                <div className="version-values">
                  <span>透水率 {v.qLu} Lu</span>
                  <span>建议 k {v.kSuggested} m/d</span>
                  <strong>确认 k {v.kConfirmed} m/d</strong>
                </div>
                {v.changeReason && (
                  <p className="change-reason">
                    <em>改值原因：</em>
                    {v.changeReason}
                  </p>
                )}
              </div>
            ))}
          </div>

          {adding === "amend" && draft && (
            <div className="draft-box amend">
              <div className="draft-head">
                <strong>事后修订 · 另存新版本</strong>
                <span className="hint-text">当前版本不会被覆盖或删除</span>
              </div>
              <label className="reason-field">
                <span>改值原因 *（不少于 5 个字）</span>
                <textarea rows={2} value={changeReason} onChange={(e) => setChangeReason(e.target.value)}
                  placeholder="如：流量计校检更正第3级读数…" />
              </label>
              <div className="pipe-row">
                <NumberField label="管路压力损失" unit="MPa" step={0.005} value={draft.pipeLoss}
                  onChange={(v) => setDraft({ ...draft, pipeLoss: v })} />
              </div>
              <div className="stage-grid">
                {draft.stages.map((s, i) => (
                  <div key={i} className="stage-col">
                    <p className="stage-title">第 {i + 1} 级</p>
                    <NumberField label="设定表压" unit="MPa" step={0.05} value={s.setPressure}
                      onChange={(v) => setStage(i, { setPressure: v })} />
                    <NumberField label="实测表压" unit="MPa" step={0.01} value={s.pressure}
                      onChange={(v) => setStage(i, { pressure: v })}
                      invalid={
                        Number.isFinite(s.pressure) &&
                        s.setPressure > 0 &&
                        Math.abs(s.pressure - s.setPressure) / s.setPressure > 0.1
                      } />
                    <NumberField label="稳定流量" unit="L/min" step={0.1} value={s.flow}
                      onChange={(v) => setStage(i, { flow: v })} />
                    <NumberField label="本级时长" unit="min" step={1} value={s.minutes}
                      onChange={(v) => setStage(i, { minutes: v })} />
                  </div>
                ))}
              </div>
              <FlagList flags={evaluateRound(hole, test, draft).flags.filter((f) => f.code !== "CROSS_LAYER")} />
              <div className="confirm-form">
                <label className="reason-field grow">
                  <span>新版本确认 k（m/d）*</span>
                  <input type="number" step={0.0001}
                    value={Number.isFinite(amendInputK) ? String(amendInputK) : ""}
                    onChange={(e) => setAmendK(e.target.value === "" ? NaN : Number(e.target.value))} />
                </label>
                <label className="reason-field grow">
                  <span>负责人签名 *</span>
                  <input value={confirmer} onChange={(e) => setConfirmer(e.target.value)} placeholder="姓名" />
                </label>
              </div>
              <div className="row-actions">
                <button onClick={cancelAdd}>取消</button>
                <button className="primary-action" disabled={!amendReady}
                  onClick={() => {
                    onAmend(changeReason.trim(), { ...draft, at: new Date().toISOString() }, confirmer.trim(), amendInputK);
                    cancelAdd();
                    setChangeReason("");
                  }}>
                  提交修订并冻结新版本
                </button>
              </div>
            </div>
          )}

          {adding !== "amend" && (
            <div className="row-actions">
              <button onClick={startAmend}>事后改值（填原因 + 修订补测，另存版本）</button>
            </div>
          )}
        </div>
      )}

      {/* 新试段：尚无初测 */}
      {test.rounds.length === 0 && !adding && !frozen && (
        <div className="row-actions">
          <button className="primary-action" onClick={() => startAdd("initial")}>登记初测三级读数</button>
        </div>
      )}
    </article>
  );
}

/** 只读的历史测次视图 */
function RoundView({
  hole,
  test,
  round,
  highlight,
  frozen,
}: {
  hole: Hole;
  test: TestRecord;
  round: Round;
  highlight: boolean;
  frozen: boolean;
}) {
  const ev = evaluateRound(hole, test, round);
  const incomplete = ev.flags.some((f) => f.code === "INCOMPLETE");
  const bad = ev.flags.some((f) => f.code !== "CROSS_LAYER");
  const num = (n: number, d = 3) => (Number.isFinite(n) && n > 0 ? n.toFixed(d) : "—");
  const raw = (n: number) => (Number.isFinite(n) ? String(n) : "—");
  const pressureBad = (i: number) => {
    const s = round.stages[i];
    return s.setPressure > 0 && Number.isFinite(s.pressure) && Math.abs(s.pressure - s.setPressure) / s.setPressure > 0.1;
  };
  const rateDen = Math.max(ev.unitRates[1], ev.unitRates[2]);
  const rateDiff = rateDen > 0 ? Math.abs(ev.unitRates[2] - ev.unitRates[1]) / rateDen : 0;
  return (
    <div className={"round-view" + (highlight ? " latest" : "") + (bad ? " bad" : "")}>
      <div className="round-head">
        <Badge tone={bad ? "danger" : "ok"}>{ROUND_LABEL[round.kind]}</Badge>
        <span>{new Date(round.at).toLocaleString("zh-CN")}</span>
        <span>管路损失 {raw(round.pipeLoss)} MPa</span>
        {incomplete && <Badge tone="muted">读数不完整</Badge>}
        {highlight && !frozen && <span className="hint-text">最新测次</span>}
      </div>
      <table className="stage-table">
        <thead>
          <tr>
            <th>级别</th><th>设定压力 MPa</th><th>实测压力 MPa</th>
            <th>稳定流量 L/min</th><th>时长 min</th><th>有效压力 MPa</th><th>折算 Lu</th>
          </tr>
        </thead>
        <tbody>
          {round.stages.map((s, i) => (
            <tr
              key={i}
              className={pressureBad(i) || (i === 2 && rateDiff > 0.1) ? "cell-bad" : ""}
            >
              <td>第{i + 1}级</td>
              <td>{raw(s.setPressure)}</td>
              <td>{raw(s.pressure)}</td>
              <td>{raw(s.flow)}</td>
              <td>{raw(s.minutes)}</td>
              <td>{num(ev.effective[i])}</td>
              <td>{ev.unitRates[i] ? ev.unitRates[i].toFixed(2) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ev.flags.filter((f) => f.code !== "CROSS_LAYER").length > 0 && (
        <ul className="flag-list compact">
          {ev.flags.filter((f) => f.code !== "CROSS_LAYER").map((f, i) => (
            <li key={i} className={"flag-" + f.code}>{f.detail}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
