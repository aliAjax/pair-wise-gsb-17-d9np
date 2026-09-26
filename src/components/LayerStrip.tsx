import { useState } from "react";
import type { Hole, TestRecord } from "../types";
import { getCrossedLayers } from "../rules";
import { SectionTitle } from "./ui";

const LAYER_COLORS = ["#0f766e", "#92400e", "#2563eb", "#7c3aed", "#0891b2", "#65a30d"];

/** 连续分层条 + 试段叠加；新增试段只能从分层界线中选顶、底界 */
export function LayerStrip({
  hole,
  tests,
  onCreate,
}: {
  hole: Hole;
  tests: TestRecord[];
  onCreate: (top: number, bottom: number) => void;
}) {
  const boundaries = hole.layers.map((l) => l.top).concat(hole.depth);
  const [top, setTop] = useState<number>(boundaries[0]);
  const [bottom, setBottom] = useState<number>(boundaries[Math.min(1, boundaries.length - 1)]);

  const preview = {
    id: "__preview",
    holeId: hole.id,
    top: Math.min(top, bottom),
    bottom: Math.max(top, bottom),
    createdAt: "",
    rounds: [],
  } as TestRecord;
  const crossed = getCrossedLayers(hole, preview);

  return (
    <section className="panel">
      <SectionTitle
        index="A"
        title="连续分层与试段选取"
        extra={<span className="hint-text">试段界线只能取自分层分界，避免与编录错位</span>}
      />

      <div className="layer-strip" style={{ height: Math.max(160, hole.depth * 9) }}>
        <div className="depth-axis">
          <span>0m</span>
          <span>{(hole.depth / 2).toFixed(1)}m</span>
          <span>{hole.depth}m</span>
        </div>
        <div className="layers">
          {hole.layers.map((l, i) => (
            <div
              key={l.id}
              className="layer-block"
              style={{
                flexGrow: l.bottom - l.top,
                background: `${LAYER_COLORS[i % LAYER_COLORS.length]}1f`,
                borderColor: LAYER_COLORS[i % LAYER_COLORS.length],
              }}
            >
              <strong>{l.lithology}</strong>
              <span>
                {l.top}–{l.bottom}m · {l.state}
                {l.note ? ` · ${l.note}` : ""}
              </span>
            </div>
          ))}
          {tests.map((t) => (
            <div
              key={t.id}
              className="seg-marker"
              style={{
                top: `${(t.top / hole.depth) * 100}%`,
                height: `${((t.bottom - t.top) / hole.depth) * 100}%`,
              }}
              title={`${t.id} ${t.top}-${t.bottom}m`}
            >
              {t.id}
            </div>
          ))}
          <div
            className={"seg-preview" + (crossed.length ? " cross" : "")}
            style={{
              top: `${(preview.top / hole.depth) * 100}%`,
              height: `${((preview.bottom - preview.top) / hole.depth) * 100}%`,
            }}
          />
        </div>
      </div>

      <div className="seg-picker">
        <label>
          <span>试段顶界</span>
          <select value={top} onChange={(e) => setTop(Number(e.target.value))}>
            {boundaries.slice(0, -1).map((b) => (
              <option key={b} value={b}>
                {b} m
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>试段底界</span>
          <select value={bottom} onChange={(e) => setBottom(Number(e.target.value))}>
            {boundaries.slice(1).map((b) => (
              <option key={b} value={b}>
                {b} m
              </option>
            ))}
          </select>
        </label>
        <div className="seg-pick-info">
          {crossed.length > 0 ? (
            <span className="text-danger">该试段跨 {crossed.length} 条分层界线，登记后自动留待复核</span>
          ) : (
            <span className="text-ok">位于单一分层内</span>
          )}
        </div>
        <button
          className="primary-action"
          disabled={preview.bottom <= preview.top}
          onClick={() => onCreate(preview.top, preview.bottom)}
        >
          圈定试段并登记
        </button>
      </div>
    </section>
  );
}
