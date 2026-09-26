import { useMemo } from "react";
import type { Borehole, StageKey, TestRegistration } from "./types";
import { STAGE_KEYS, STAGE_LABELS } from "./types";
import { evaluate, spanLayers } from "./rules";

export interface FormState {
  id: string;
  holeId: string;
  segmentTop: string;
  segmentBottom: string;
  setPressure: string;
  pipeLoss: string;
  stages: TestRegistration["stages"];
  testDate: string;
  operator: string;
  retestOf?: string;
}

export function emptyForm(id: string, holeId: string): FormState {
  return {
    id,
    holeId,
    segmentTop: "",
    segmentBottom: "",
    setPressure: "1.00",
    pipeLoss: "",
    stages: {
      s1: { pressure: "", flow: "", minutes: "20" },
      s2: { pressure: "", flow: "", minutes: "20" },
      s3: { pressure: "", flow: "", minutes: "20" },
    },
    testDate: new Date().toISOString().slice(0, 10),
    operator: "",
  };
}

export function regToForm(reg: TestRegistration): FormState {
  return JSON.parse(JSON.stringify(reg));
}

export function formToReg(f: FormState): TestRegistration {
  return JSON.parse(JSON.stringify(f));
}

interface Props {
  form: FormState;
  hole: Borehole | undefined;
  onChange: (f: FormState) => void;
  onSave: (asDraft: boolean) => void;
  onCancel?: () => void;
  saving?: boolean;
  submitLabel?: string;
}

function num(s: string): number | null {
  const t = s.trim();
  if (t === "" || !Number.isFinite(Number(t))) return null;
  return Number(t);
}

export default function RegistrationForm({
  form,
  hole,
  onChange,
  onSave,
  onCancel,
  saving,
  submitLabel,
}: Props) {
  const top = num(form.segmentTop);
  const bottom = num(form.segmentBottom);

  const spanned = useMemo(() => {
    if (!hole || top === null || bottom === null || bottom <= top) return [];
    return spanLayers(hole, top, bottom);
  }, [hole, top, bottom]);

  const preview = useMemo(() => {
    if (!hole) return null;
    return evaluate(formToReg(form), hole);
  }, [form, hole]);

  const set = (patch: Partial<FormState>) => onChange({ ...form, ...patch });
  const setStage = (k: StageKey, patch: Partial<FormState["stages"][StageKey]>) =>
    onChange({
      ...form,
      stages: { ...form.stages, [k]: { ...form.stages[k], ...patch } },
    });

  const cross = spanned.length > 1;

  return (
    <div className="reg-form">
      {form.retestOf && (
        <div className="retest-banner">复测登记，原试段记录编号 {form.retestOf}</div>
      )}

      <div className="field-grid">
        <label>
          <span>钻孔编号</span>
          <input value={form.holeId} readOnly className="readonly" />
        </label>
        <label>
          <span>记录编号</span>
          <input value={form.id} readOnly className="readonly" />
        </label>
        <label>
          <span>试段顶深 (m)</span>
          <input
            inputMode="decimal"
            placeholder="如 10.0"
            value={form.segmentTop}
            onChange={(e) => set({ segmentTop: e.target.value })}
          />
        </label>
        <label>
          <span>试段底深 (m)</span>
          <input
            inputMode="decimal"
            placeholder="如 15.0"
            value={form.segmentBottom}
            onChange={(e) => set({ segmentBottom: e.target.value })}
          />
        </label>
        <label>
          <span>设定试验压力 (MPa)</span>
          <input
            inputMode="decimal"
            value={form.setPressure}
            onChange={(e) => set({ setPressure: e.target.value })}
          />
        </label>
        <label>
          <span>管路损失 (MPa)</span>
          <input
            inputMode="decimal"
            placeholder="按钻杆长度查表"
            value={form.pipeLoss}
            onChange={(e) => set({ pipeLoss: e.target.value })}
          />
        </label>
        <label>
          <span>试验日期</span>
          <input
            type="date"
            value={form.testDate}
            onChange={(e) => set({ testDate: e.target.value })}
          />
        </label>
        <label>
          <span>现场记录人</span>
          <input
            placeholder="纸上抄录人"
            value={form.operator}
            onChange={(e) => set({ operator: e.target.value })}
          />
        </label>
      </div>

      {/* 命中分层：直接对照连续编录，防止试段与分层错位 */}
      <div className={"span-preview" + (cross ? " bad" : spanned.length === 1 ? " good" : "")}>
        <span className="span-title">命中分层</span>
        {spanned.length === 0 && <em>输入合法试段深度后显示对应分层</em>}
        {spanned.map((l, i) => (
          <span key={i} className="span-chip">
            {l.name}
            <small>
              {l.top}~{l.bottom}m
            </small>
          </span>
        ))}
        {cross && <strong className="bad-text">试段跨 {spanned.length} 层 → 待复核</strong>}
        {spanned.length === 1 && <strong className="good-text">位于同一分层内</strong>}
      </div>

      <h3 className="stage-heading">三级压力与流量（纸上抄录录入）</h3>
      <div className="stage-table-wrap">
        <table className="stage-table">
          <thead>
            <tr>
              <th>级别</th>
              <th>实测表压 (MPa)</th>
              <th>有效压力 (MPa)</th>
              <th>流量 (L/min)</th>
              <th>时长 (min)</th>
              <th>偏离/稳定性</th>
            </tr>
          </thead>
          <tbody>
            {STAGE_KEYS.map((k, i) => {
              const r = form.stages[k];
              const p = num(r.pressure);
              const loss = num(form.pipeLoss);
              const eff = p !== null && loss !== null ? p - loss : null;
              const dev = preview?.metrics.devs.find((d) => d.stage === k);
              return (
                <tr key={k}>
                  <td className="stage-name">{STAGE_LABELS[i]}</td>
                  <td>
                    <input
                      inputMode="decimal"
                      value={r.pressure}
                      onChange={(e) => setStage(k, { pressure: e.target.value })}
                    />
                  </td>
                  <td className="eff-cell">{eff === null ? "—" : eff.toFixed(3)}</td>
                  <td>
                    <input
                      inputMode="decimal"
                      value={r.flow}
                      onChange={(e) => setStage(k, { flow: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      inputMode="numeric"
                      value={r.minutes}
                      onChange={(e) => setStage(k, { minutes: e.target.value })}
                    />
                  </td>
                  <td>
                    {dev ? (
                      <span className={dev.ratio > 0.1 ? "tag danger" : "tag ok"}>
                        {(dev.ratio * 100).toFixed(1)}%
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flow-hint">
        后两级流量差：
        {preview?.metrics.flowRatio === null || preview?.metrics.flowRatio === undefined ? (
          "—"
        ) : (
          <span className={preview.metrics.flowRatio > 0.1 ? "tag danger" : "tag ok"}>
            {(preview.metrics.flowRatio * 100).toFixed(1)}%
          </span>
        )}
        <small>（Q3 与 Q2 之差 / Q2，超过 10% 判流量未稳定）</small>
      </div>

      {/* 提交前判定预览 */}
      {preview && preview.issues.length > 0 && (
        <ul className="issue-preview">
          {preview.issues.map((iss) => (
            <li key={iss.code} className={iss.code === "INCOMPLETE" ? "warn" : "danger"}>
              <b>{iss.label}</b>
              <span>{iss.detail}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="form-actions">
        <button onClick={() => onSave(true)}>暂存草稿</button>
        <button className="primary-action" onClick={() => onSave(false)}>
          {submitLabel || "保存并提交判定"}
        </button>
        {onCancel && (
          <button className="ghost" onClick={onCancel}>
            放弃
          </button>
        )}
      </div>
      {saving === false && null}
    </div>
  );
}
