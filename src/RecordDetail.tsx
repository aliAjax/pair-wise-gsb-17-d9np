import { useState } from "react";
import type { Borehole, KUnit, TestRegistration, Verdict } from "./types";
import { STAGE_KEYS, STAGE_LABELS } from "./types";
import { calcLu, evaluate } from "./rules";

interface Props {
  reg: TestRegistration;
  hole: Borehole | undefined;
  verdict: Verdict | undefined;
  onClose: () => void;
  onSaveNote: (note: string) => void;
  onRetest: () => void;
  onCorrect: () => void;
  onConfirmK: (value: string, unit: KUnit, name: string) => void;
  onReviseK: (value: string, unit: KUnit, name: string, reason: string) => void;
  onDeleteDraft: () => void;
}

export default function RecordDetail({
  reg,
  hole,
  verdict,
  onClose,
  onSaveNote,
  onRetest,
  onCorrect,
  onConfirmK,
  onReviseK,
  onDeleteDraft,
}: Props) {
  const evalResult = evaluate(reg, hole);
  const lu = calcLu(reg);
  const status = verdict?.status ?? "draft";
  const frozen = verdict?.versions[verdict.versions.length - 1];

  const [note, setNote] = useState(verdict?.note ?? "");
  const [kValue, setKValue] = useState(frozen?.k.value ?? "");
  const [kUnit, setKUnit] = useState<KUnit>(frozen?.k.unit ?? "m/d");
  const [kName, setKName] = useState("");
  const [revReason, setRevReason] = useState("");
  const [revising, setRevising] = useState(false);

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <p className="eyebrow">
              {reg.holeId} · {reg.id}
              {reg.retestOf && ` · 复测自 ${reg.retestOf}`}
            </p>
            <h2>
              试段 {reg.segmentTop || "?"}~{reg.segmentBottom || "?"}m
              <span className={"status-pill st-" + status}>{statusLabel(status)}</span>
            </h2>
          </div>
          <button className="ghost" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="modal-body">
          <section className="detail-block">
            <h3>试验条件</h3>
            <div className="kv-grid">
              <div><span>设定压力</span><b>{reg.setPressure} MPa</b></div>
              <div><span>管路损失</span><b>{reg.pipeLoss} MPa</b></div>
              <div><span>试验日期</span><b>{reg.testDate || "—"}</b></div>
              <div><span>记录人</span><b>{reg.operator || "—"}</b></div>
              <div><span>命中分层</span>
                <b>{evalResult.metrics.spanned.map((l) => l.name).join("、") || "—"}</b>
              </div>
              <div><span>试段长度</span>
                <b>{lengthText(reg)}</b>
              </div>
            </div>
          </section>

          <section className="detail-block">
            <h3>三级读数</h3>
            <table className="stage-table compact">
              <thead>
                <tr>
                  <th>级别</th><th>表压 MPa</th><th>有效压力</th>
                  <th>流量 L/min</th><th>时长 min</th><th>偏离</th>
                </tr>
              </thead>
              <tbody>
                {STAGE_KEYS.map((k, i) => {
                  const r = reg.stages[k];
                  const dev = evalResult.metrics.devs.find((d) => d.stage === k);
                  return (
                    <tr key={k}>
                      <td>{STAGE_LABELS[i]}</td>
                      <td>{r.pressure}</td>
                      <td>{dev ? dev.effective.toFixed(3) : "—"}</td>
                      <td>{r.flow}</td>
                      <td>{r.minutes}</td>
                      <td>
                        {dev ? (
                          <span className={dev.ratio > 0.1 ? "tag danger" : "tag ok"}>
                            {(dev.ratio * 100).toFixed(1)}%
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="lu-line">
              吕荣值（第三级 Lu = Q/P有效/L）：
              <b>{lu === null ? "资料不齐，无法计算" : lu.toFixed(2) + " Lu"}</b>
            </p>
          </section>

          <section className="detail-block">
            <h3>自动判定</h3>
            {evalResult.issues.length === 0 ? (
              <p className="verdict-ok">✓ 资料齐全，试段同层、压力偏离与后两级流量差均在一成以内，可进入负责人确认。</p>
            ) : (
              <ul className="issue-preview">
                {evalResult.issues.map((iss) => (
                  <li key={iss.code} className={iss.code === "INCOMPLETE" ? "warn" : "danger"}>
                    <b>{iss.label}</b>
                    <span>{iss.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 待复核原因：硬性问题必须写明；抄录有误可更正重判，现场异常须复测后才能通过 */}
          {(status === "pending" || status === "draft") && (
            <section className="detail-block">
              <h3>复核记录</h3>
              <textarea
                className="note-box"
                placeholder="写明留在待复核的原因（如：试段跨强风化/中风化界面，压力偏高）及复测安排"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="form-actions">
                <button onClick={() => onSaveNote(note)}>保存原因说明</button>
                {status === "pending" && (
                  <button onClick={onCorrect}>更正纸上抄录后重判</button>
                )}
                <button className="primary-action" onClick={onRetest}>
                  登记现场复测
                </button>
                {status === "draft" && (
                  <button className="danger-ghost" onClick={onDeleteDraft}>
                    删除草稿
                  </button>
                )}
              </div>
              {status === "pending" && (
                <p className="hint">
                  注：仅当纸上抄录有误时可直接更正；属跨层、压力或流量真实异常的，须现场复测，新记录通过后本记录自动转为“已复测替代”。
                </p>
              )}
            </section>
          )}

          {/* 负责人确认渗透系数 → 冻结 */}
          {status === "qualified" && (
            <section className="detail-block freeze-box">
              <h3>负责人确认渗透系数</h3>
              <p className="hint">确认后结果随即冻结，现场资料与本结果一并固化，事后改值须另留原因版本。</p>
              <div className="k-row">
                <label>
                  <span>渗透系数 K</span>
                  <input
                    inputMode="decimal"
                    placeholder="如 2.4e-5"
                    value={kValue}
                    onChange={(e) => setKValue(e.target.value)}
                  />
                </label>
                <label>
                  <span>单位</span>
                  <select value={kUnit} onChange={(e) => setKUnit(e.target.value as KUnit)}>
                    <option value="m/d">m/d</option>
                    <option value="cm/s">cm/s</option>
                  </select>
                </label>
                <label className="grow">
                  <span>负责人签名</span>
                  <input placeholder="项目负责人姓名" value={kName} onChange={(e) => setKName(e.target.value)} />
                </label>
              </div>
              <div className="form-actions">
                <button
                  className="primary-action"
                  disabled={kValue.trim() === "" || kName.trim() === ""}
                  onClick={() => onConfirmK(kValue.trim(), kUnit, kName.trim())}
                >
                  确认 K 并冻结结果
                </button>
              </div>
            </section>
          )}

          {/* 已冻结：展示版本，改值另起原因版本 */}
          {status === "frozen" && frozen && (
            <section className="detail-block freeze-box">
              <h3>冻结结果</h3>
              <div className="frozen-k">
                <b>
                  K = {frozen.k.value} {frozen.k.unit}
                </b>
                <span>
                  {frozen.confirmedBy} 于 {new Date(frozen.confirmedAt).toLocaleString("zh-CN")} 确认
                </span>
                {frozen.lu && <span className="tag ok">参考 {frozen.lu} Lu</span>}
              </div>
              {!revising ? (
                <div className="form-actions">
                  <button onClick={() => setRevising(true)}>事后改值（另留原因版本）</button>
                </div>
              ) : (
                <div className="revise-box">
                  <div className="k-row">
                    <label>
                      <span>新 K 值</span>
                      <input value={kValue} onChange={(e) => setKValue(e.target.value)} />
                    </label>
                    <label>
                      <span>单位</span>
                      <select value={kUnit} onChange={(e) => setKUnit(e.target.value as KUnit)}>
                        <option value="m/d">m/d</option>
                        <option value="cm/s">cm/s</option>
                      </select>
                    </label>
                    <label className="grow">
                      <span>负责人</span>
                      <input value={kName} onChange={(e) => setKName(e.target.value)} placeholder="签名" />
                    </label>
                  </div>
                  <label className="reason-label">
                    <span>改值原因（必填，留痕）</span>
                    <textarea
                      className="note-box"
                      value={revReason}
                      onChange={(e) => setRevReason(e.target.value)}
                      placeholder="如：复核芯样裂隙率后按区间水位修正"
                    />
                  </label>
                  <div className="form-actions">
                    <button
                      className="primary-action"
                      disabled={
                        kValue.trim() === "" ||
                        kName.trim() === "" ||
                        revReason.trim() === ""
                      }
                      onClick={() => {
                        onReviseK(kValue.trim(), kUnit, kName.trim(), revReason.trim());
                        setRevising(false);
                      }}
                    >
                      保存新版本
                    </button>
                    <button className="ghost" onClick={() => setRevising(false)}>
                      取消
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* 版本历史：原冻结值永久保留 */}
          {verdict && verdict.versions.length > 0 && (
            <section className="detail-block">
              <h3>结果版本（{verdict.versions.length}）</h3>
              <ul className="version-list">
                {[...verdict.versions].reverse().map((v) => (
                  <li key={v.version}>
                    <b>v{v.version}</b>
                    <span>
                      K = {v.k.value} {v.k.unit}
                    </span>
                    <span>
                      {v.confirmedBy} · {new Date(v.confirmedAt).toLocaleString("zh-CN")}
                    </span>
                    {v.reason && <em>改值原因：{v.reason}</em>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function lengthText(reg: TestRegistration): string {
  const t = Number(reg.segmentTop);
  const b = Number(reg.segmentBottom);
  if (!Number.isFinite(t) || !Number.isFinite(b) || b <= t) return "—";
  return `${(b - t).toFixed(2)} m`;
}

function statusLabel(s: Verdict["status"]): string {
  return {
    draft: "草稿",
    pending: "待复核",
    qualified: "待确认K",
    frozen: "已冻结",
    superseded: "已复测替代",
  }[s];
}
