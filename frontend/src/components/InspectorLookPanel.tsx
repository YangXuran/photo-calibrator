import type { PointerEvent } from "react";
import type { WorkbenchController } from "../hooks/useWorkbench";
import type { LookAdjustments, LookWheel } from "../types";
import { PaneSection } from "./PaneSection";

type InspectorLookPanelProps = {
  workbench: WorkbenchController;
};

const WHEEL_ZONES: Array<{ key: keyof LookAdjustments["colorGrade"]; label: string }> = [
  { key: "shadows", label: "阴影" },
  { key: "midtones", label: "中间调" },
  { key: "highlights", label: "高光" },
  { key: "global", label: "全局" },
];

const DEFAULT_WHEELS: Record<string, LookWheel> = {
  shadows: { hue: 225, saturation: 0, luminance: 0 },
  midtones: { hue: 35, saturation: 0, luminance: 0 },
  highlights: { hue: 45, saturation: 0, luminance: 0 },
  global: { hue: 35, saturation: 0, luminance: 0 },
  point: { hue: 120, saturation: 1, luminance: 0 },
};

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

function polarToWheel(hue: number, saturation: number, size: number) {
  const radius = (size / 2 - 10) * clamp(saturation, 0, 1);
  const angle = (hue * Math.PI) / 180;
  return {
    x: size / 2 + Math.cos(angle) * radius,
    y: size / 2 - Math.sin(angle) * radius,
  };
}

function wheelFromPointer(event: PointerEvent<SVGSVGElement>, size: number) {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * size;
  const y = ((event.clientY - rect.top) / rect.height) * size;
  const dx = x - size / 2;
  const dy = size / 2 - y;
  const radius = size / 2 - 10;
  const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  const saturation = clamp(Math.sqrt(dx * dx + dy * dy) / radius, 0, 1);
  return { hue, saturation };
}

function LookColorWheel({
  label,
  wheel,
  onPreview,
  onCommit,
  onBegin,
  onReset,
  testId,
}: {
  label: string;
  wheel: LookWheel;
  onPreview: (next: LookWheel) => void;
  onCommit: (next: LookWheel) => void;
  onBegin: () => void;
  onReset: () => void;
  testId: string;
}) {
  const size = 104;
  const point = polarToWheel(wheel.hue, wheel.saturation, size);
  const resetOnDoubleClick = (event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.preventDefault();
    event.stopPropagation();
    onBegin();
    onReset();
  };

  function update(event: PointerEvent<SVGSVGElement>, commit = false) {
    const next = { ...wheel, ...wheelFromPointer(event, size) };
    if (commit) onCommit(next);
    else onPreview(next);
  }

  return (
    <div
      className="pc-look-wheel-card"
      data-testid={testId}
      onDoubleClick={resetOnDoubleClick}
    >
      <svg
        className="pc-look-wheel"
        onClick={(event) => {
          if (event.detail >= 2) resetOnDoubleClick(event);
        }}
        onDoubleClick={(event) => {
          resetOnDoubleClick(event);
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          onBegin();
          update(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons !== 1) return;
          update(event);
        }}
        onPointerUp={(event) => update(event, true)}
        role="img"
        viewBox={`0 0 ${size} ${size}`}
      >
        <defs>
          <radialGradient id={`${testId}-sat`}>
            <stop offset="0%" stopColor="white" />
            <stop offset="100%" stopColor={`hsl(${wheel.hue}, 90%, 55%)`} />
          </radialGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={size / 2 - 10} className="pc-look-wheel-ring" />
        <circle cx={size / 2} cy={size / 2} r={size / 2 - 10} fill={`url(#${testId}-sat)`} opacity="0.72" />
        <line x1={size / 2} y1="10" x2={size / 2} y2={size - 10} className="pc-look-axis" />
        <line x1="10" y1={size / 2} x2={size - 10} y2={size / 2} className="pc-look-axis" />
        <circle cx={point.x} cy={point.y} r="5.5" className="pc-look-handle" />
      </svg>
      <span>{label}</span>
      <small>{Math.round(wheel.hue)}° / {wheel.saturation.toFixed(2)}</small>
    </div>
  );
}

export function InspectorLookPanel({ workbench }: InspectorLookPanelProps) {
  const look = workbench.lookAdjustments;

  function updateLook(next: LookAdjustments, commit = false, description = "片色调整") {
    if (commit) workbench.commitLookAdjustments(next, description);
    else workbench.previewLookAdjustments(next);
  }

  function updateLabFromPointer(event: PointerEvent<SVGSVGElement>, commit = false) {
    const size = 180;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * size;
    const y = ((event.clientY - rect.top) / rect.height) * size;
    const next = {
      ...look,
      labBias: {
        a: clamp(((x - size / 2) / (size / 2 - 14)) * 30, -30, 30),
        b: clamp(((size / 2 - y) / (size / 2 - 14)) * 30, -30, 30),
      },
    };
    updateLook(next, commit, "色偏微调");
  }

  function updateWheel(zone: keyof LookAdjustments["colorGrade"], wheel: LookWheel, commit = false) {
    updateLook({
      ...look,
      colorGrade: {
        ...look.colorGrade,
        [zone]: wheel,
      },
    }, commit, `${WHEEL_ZONES.find((item) => item.key === zone)?.label ?? "色轮"}片色`);
  }

  function updateGradeValue(key: "blending" | "balance", value: number, commit = false) {
    updateLook({
      ...look,
      colorGrade: {
        ...look.colorGrade,
        [key]: value,
      },
    }, commit, "色轮过渡");
  }

  function updatePointColor(patch: Partial<LookAdjustments["pointColor"]>, commit = false) {
    updateLook({
      ...look,
      pointColor: {
        ...look.pointColor,
        ...patch,
      },
    }, commit, "点选颜色");
  }

  const labSize = 180;
  const labX = labSize / 2 + (look.labBias.a / 30) * (labSize / 2 - 14);
  const labY = labSize / 2 - (look.labBias.b / 30) * (labSize / 2 - 14);

  return (
    <div className="pc-stack">
      <PaneSection
        collapseStorageKey="inspector-look-lab-bias"
        collapseStorageScope="workbench"
        collapsible
        emphasis="primary"
        testId="look-lab-section"
        title="色偏微调"
      >
        <div className="pc-look-lab-grid">
          <svg
            className="pc-look-lab-pad"
            data-testid="look-lab-pad"
          onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              workbench.beginEdit();
              updateLabFromPointer(event);
            }}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              workbench.beginEdit();
              updateLook({ ...look, labBias: { a: 0, b: 0 } }, true, "重置色偏");
            }}
            onPointerMove={(event) => {
              if (event.buttons !== 1) return;
              updateLabFromPointer(event);
            }}
            onPointerUp={(event) => updateLabFromPointer(event, true)}
            viewBox={`0 0 ${labSize} ${labSize}`}
          >
            <defs>
              <linearGradient id="pc-lab-x" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#22c55e" />
                <stop offset="50%" stopColor="#e5e7eb" />
                <stop offset="100%" stopColor="#ef4444" />
              </linearGradient>
              <linearGradient id="pc-lab-y" x1="0" x2="0" y1="1" y2="0">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="50%" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="100%" stopColor="#f59e0b" />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width={labSize} height={labSize} rx="16" fill="url(#pc-lab-x)" opacity="0.7" />
            <rect x="0" y="0" width={labSize} height={labSize} rx="16" fill="url(#pc-lab-y)" opacity="0.72" />
            <line x1={labSize / 2} y1="10" x2={labSize / 2} y2={labSize - 10} className="pc-look-axis" />
            <line x1="10" y1={labSize / 2} x2={labSize - 10} y2={labSize / 2} className="pc-look-axis" />
            <circle cx={labX} cy={labY} r="7" className="pc-look-handle" />
          </svg>
          <div className="pc-look-readout">
            <span>a* {look.labBias.a.toFixed(1)}</span>
            <span>b* {look.labBias.b.toFixed(1)}</span>
            <button className="pc-button pc-button-secondary pc-button-small" onClick={workbench.resetLookAdjustments} type="button">
              重置 Look
            </button>
          </div>
        </div>
      </PaneSection>

      <PaneSection
        collapseStorageKey="inspector-look-wheels"
        collapseStorageScope="workbench"
        collapsible
        testId="look-wheels-section"
        title="三路色轮"
      >
        <div className="pc-look-wheel-grid">
          {WHEEL_ZONES.map(({ key, label }) => (
            <LookColorWheel
              key={key}
              label={label}
              onBegin={workbench.beginEdit}
              onCommit={(next) => updateWheel(key, next, true)}
              onPreview={(next) => updateWheel(key, next)}
              onReset={() => updateWheel(key, DEFAULT_WHEELS[String(key)], true)}
              testId={`look-wheel-${key}`}
              wheel={look.colorGrade[key] as LookWheel}
            />
          ))}
        </div>
        <label className="pc-field">
          <span>过渡 {look.colorGrade.blending.toFixed(2)}</span>
          <input
            max={1}
            min={0}
            onChange={(event) => updateGradeValue("blending", Number(event.target.value))}
            onPointerDown={workbench.beginEdit}
            onPointerUp={(event) => updateGradeValue("blending", Number(event.currentTarget.value), true)}
            step={0.01}
            type="range"
            value={look.colorGrade.blending}
          />
        </label>
        <label className="pc-field">
          <span>平衡 {look.colorGrade.balance.toFixed(2)}</span>
          <input
            max={1}
            min={-1}
            onChange={(event) => updateGradeValue("balance", Number(event.target.value))}
            onPointerDown={workbench.beginEdit}
            onPointerUp={(event) => updateGradeValue("balance", Number(event.currentTarget.value), true)}
            step={0.01}
            type="range"
            value={look.colorGrade.balance}
          />
        </label>
      </PaneSection>

      <PaneSection
        collapseStorageKey="inspector-look-point-color"
        collapseStorageScope="workbench"
        collapsible
        testId="look-point-color-section"
        title="点选颜色"
      >
        <label className="pc-field pc-field-checkbox">
          <input
            checked={look.pointColor.enabled}
            data-testid="look-point-color-enabled"
            onChange={(event) => {
              workbench.beginEdit();
              updatePointColor({ enabled: event.currentTarget.checked }, true);
            }}
            type="checkbox"
          />
          <span>启用点选颜色</span>
        </label>
        <LookColorWheel
          label="目标颜色"
          onBegin={workbench.beginEdit}
          onCommit={(next) => updatePointColor({ hue: next.hue }, true)}
          onPreview={(next) => updatePointColor({ hue: next.hue })}
          onReset={() => updatePointColor({ hue: DEFAULT_WHEELS.point.hue }, true)}
          testId="look-point-hue"
          wheel={{ hue: look.pointColor.hue, saturation: 1, luminance: 0 }}
        />
        {[
          ["range", "范围", 2, 90, 1],
          ["hueShift", "色相", -90, 90, 1],
          ["saturation", "饱和", -1, 1, 0.01],
          ["luminance", "亮度", -1, 1, 0.01],
        ].map(([key, label, min, max, step]) => (
          <label className="pc-field" key={String(key)}>
            <span>{label} {Number(look.pointColor[key as keyof LookAdjustments["pointColor"]]).toFixed(Number(step) < 1 ? 2 : 0)}</span>
            <input
              max={Number(max)}
              min={Number(min)}
              onChange={(event) => updatePointColor({ [key]: Number(event.target.value) } as Partial<LookAdjustments["pointColor"]>)}
              onPointerDown={workbench.beginEdit}
              onPointerUp={(event) => updatePointColor({ [key]: Number(event.currentTarget.value) } as Partial<LookAdjustments["pointColor"]>, true)}
              step={Number(step)}
              type="range"
              value={Number(look.pointColor[key as keyof LookAdjustments["pointColor"]])}
            />
          </label>
        ))}
      </PaneSection>
    </div>
  );
}
