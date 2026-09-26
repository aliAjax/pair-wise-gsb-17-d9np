import type { ReactNode } from "react";

export function NumberField({
  label,
  value,
  onChange,
  unit,
  step = 0.01,
  invalid,
  disabled,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit: string;
  step?: number;
  invalid?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  return (
    <label className={"num-field" + (invalid ? " invalid" : "")}>
      <span>
        {label}
        <em>{unit}</em>
      </span>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? String(value) : ""}
        disabled={disabled}
        placeholder="—"
        onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
      />
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function Badge({ tone, children }: { tone: "ok" | "warn" | "danger" | "muted"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function SectionTitle({ index, title, extra }: { index: string; title: string; extra?: ReactNode }) {
  return (
    <div className="section-title">
      <div>
        <i>{index}</i>
        <h3>{title}</h3>
      </div>
      {extra}
    </div>
  );
}
