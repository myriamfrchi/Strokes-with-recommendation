import { useState, useRef, useEffect } from "react";
import { Info, ChevronDown, X } from "lucide-react";

// ── Config ───────────────────────────────────────────────────────────────────

const patientIds = ["1011", "1042", "1078", "1095", "1130"];

interface SliderConfig {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  unit: string;
  default: number;
  dangerHigh?: number;
  lowerIsBetter?: boolean;
  isTile?: boolean;
  noChart?: boolean; // skip distribution chart
}

interface BoolParam {
  key: string;
  label: string;
  group: "Risk Factors" | "Clinical" | "Discharge";
  riskIfTrue: boolean;
}

const SLIDERS: SliderConfig[] = [
  { key: "sysBP",          label: "Sys Blood Pressure", min: 40,  max: 220, unit: "mmHg",  default: 150, dangerHigh: 140 },
  { key: "disBP",          label: "Dis Blood Pressure",  min: 40,  max: 140, unit: "mmHg",  default: 95,  dangerHigh: 90 },
  { key: "glucose",        label: "Glucose",             min: 50,  max: 400, unit: "mg/dL", default: 200, dangerHigh: 126 },
  { key: "cholesterol",    label: "Cholesterol",         min: 100, max: 400, unit: "mg/dL", default: 260, dangerHigh: 200 },
  { key: "prestrokeMrs",   label: "Pre-stroke mRS",      min: 0,   max: 5,   unit: "",      default: 2,   dangerHigh: 2,  step: 1, noChart: true },
  { key: "doorToImaging",  label: "Door to Imaging",     min: 0,   max: 180, unit: "min",   default: 45,  dangerHigh: 60, lowerIsBetter: true, isTile: true },
  { key: "onsetToDoor",    label: "Onset to Door",       min: 0,   max: 600, unit: "min",   default: 180, dangerHigh: 120, lowerIsBetter: true, isTile: true },
  { key: "doorToNeedle",   label: "Door to Needle",      min: 0,   max: 180, unit: "min",   default: 45,  dangerHigh: 60, lowerIsBetter: true, isTile: true },
];

const BOOL_PARAMS: BoolParam[] = [
  { key: "risk_hypertension",          label: "Hypertension",            group: "Risk Factors", riskIfTrue: true },
  { key: "risk_diabetes",              label: "Diabetes",                group: "Risk Factors", riskIfTrue: true },
  { key: "risk_smoker",                label: "Smoker",                  group: "Risk Factors", riskIfTrue: true },
  { key: "risk_arterialfibrilation",   label: "Atrial Fibrillation",     group: "Risk Factors", riskIfTrue: true },
  { key: "prenotification",            label: "Pre-notification",        group: "Clinical",     riskIfTrue: false },
  { key: "hospitalized_in",            label: "Hospitalized In",         group: "Clinical",     riskIfTrue: false },
  { key: "bleeding_volume_value",      label: "Bleeding Volume",         group: "Clinical",     riskIfTrue: true },
  { key: "imaging_done",               label: "Imaging Done",            group: "Clinical",     riskIfTrue: false },
  { key: "occup_physiotherapy_received", label: "Physiotherapy",         group: "Discharge",    riskIfTrue: false },
  { key: "discharge_antiplatlets_any", label: "Antiplatelets",           group: "Discharge",    riskIfTrue: false },
  { key: "Discharge_anticoagulents_any", label: "Anticoagulants",        group: "Discharge",    riskIfTrue: false },
];

// ── Distribution metadata ────────────────────────────────────────────────────

interface FactorMeta {
  optimalRange: [number, number]; // [low, high] safe zone — U/J shape pivots here
  source: string; study: string; doi: string;
}

const FACTOR_META: Record<string, FactorMeta> = {
  sysBP: {
    optimalRange: [100, 130],
    source: "SPRINT Trial (2015) — NEJM",
    study: "The SPRINT Research Group showed intensive systolic BP control (<120 mmHg) reduced major CV events by 25% and all-cause mortality by 27%. Values >140 mmHg are classified Stage 1 hypertension (ACC/AHA 2017 guidelines), conferring a 2× stroke risk increase.",
    doi: "10.1056/NEJMoa1511939",
  },
  glucose: {
    optimalRange: [70, 100],
    source: "UKPDS 35 (2000) — BMJ",
    study: "Each 1% HbA1c reduction correlates with a 21% drop in diabetes-related deaths and 14% reduction in MI. Fasting glucose >126 mg/dL meets WHO diagnostic threshold for diabetes, independently predicting adverse stroke outcomes and 8% excess CV risk.",
    doi: "10.1136/bmj.321.7258.405",
  },
  disBP: {
    optimalRange: [70, 85],
    source: "HOT Trial (1998) — Lancet",
    study: "HOT trial (18,790 patients) showed targeting DBP ≤90 mmHg significantly reduced CV events. Diabetic patients at ≤80 mmHg had 51% fewer events. DBP consistently >90 mmHg doubles stroke risk independently of systolic pressure.",
    doi: "10.1016/S0140-6736(98)04311-6",
  },
  cholesterol: {
    optimalRange: [140, 185],
    source: "CTT Collaboration (2010) — Lancet",
    study: "Meta-analysis of 170,000 participants: each 1 mmol/L LDL-C reduction reduces major vascular events by 22%. Statin therapy in patients with total cholesterol >200 mg/dL yields 11% absolute risk reduction over 5 years in high-risk individuals.",
    doi: "10.1016/S0140-6736(10)61350-5",
  },
  doorToImaging: {
    optimalRange: [0, 25],
    source: "Minnerup et al. (2012) — Stroke",
    study: "Hospitals with door-to-imaging <25 min achieve thrombolysis rates 3× higher and significantly better 90-day mRS scores. Delays beyond 60 min are independently associated with poorer reperfusion outcomes and a 9% reduction in functional independence at discharge.",
    doi: "10.1161/STROKEAHA.111.648550",
  },
  onsetToDoor: {
    optimalRange: [0, 60],
    source: "IST-3 Collaborative Group (2012) — Lancet",
    study: "Every 15-minute delay after stroke onset reduces patients with good outcomes by ~1 per 100 treated. Patients treated within 3 hours had OR 1.53 for good outcomes. Pre-hospital notification protocols reduce onset-to-door time by an average of 38 minutes.",
    doi: "10.1016/S0140-6736(12)60768-5",
  },
  doorToNeedle: {
    optimalRange: [0, 45],
    source: "Fonarow et al. (2011) — JAMA",
    study: "Each 15-min reduction in DTN time reduces in-hospital mortality (OR 0.96), symptomatic ICH, and increases independent ambulation at discharge. Hospitals achieving DTN <60 min had 25% better functional outcomes across 25,504 IV tPA-treated patients.",
    doi: "10.1001/jama.2011.1706",
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAtRisk(cfg: SliderConfig, val: number) {
  if (cfg.dangerHigh === undefined) return false;
  return val > cfg.dangerHigh;
}

function riskScore(cfg: SliderConfig, val: number) {
  if (cfg.lowerIsBetter) return Math.min(100, (val / cfg.max) * 100);
  return Math.min(100, ((val - cfg.min) / (cfg.max - cfg.min)) * 100);
}

function overallRisk(values: Record<string, number>, boolValues: Record<string, boolean>) {
  const sliderRisk =
    SLIDERS.map((s) => riskScore(s, values[s.key])).reduce((a, b) => a + b, 0) / SLIDERS.length;

  let boolPenalty = 0;
  BOOL_PARAMS.forEach((p) => {
    const isRisky = p.riskIfTrue ? boolValues[p.key] : !boolValues[p.key];
    if (isRisky) boolPenalty += 8;
  });
  const maxBoolPenalty = BOOL_PARAMS.length * 8;
  const boolRiskPct = (boolPenalty / maxBoolPenalty) * 100;

  return Math.round(Math.min(100, sliderRisk * 0.65 + boolRiskPct * 0.35));
}

function mrsFromPct(pct: number): number {
  if (pct >= 84) return 5;
  if (pct >= 67) return 4;
  if (pct >= 51) return 3;
  if (pct >= 34) return 2;
  if (pct >= 17) return 1;
  return 0;
}

const MRS_COLORS = ["#22c55e", "#84cc16", "#eab308", "#f97316", "#ef4444", "#b91c1c"];
const MRS_LABELS = ["No disability", "No sig. disability", "Slight disability", "Moderate disability", "Mod. severe disability", "Severe disability"];

// ── Popup helper ─────────────────────────────────────────────────────────────

function usePopup() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);
  return { open, setOpen, ref };
}

// ── Risk Curve Chart (Partial Dependence Plot) ────────────────────────────────

function RiskCurveChart({ cfg, meta, value }: { cfg: SliderConfig; meta: FactorMeta; value: number }) {
  const W = 220, H = 72, PX = 8, PY = 6;
  const plotW = W - PX * 2;
  const plotH = H - PY - 18;
  const N = 200;
  const [optLow, optHigh] = meta.optimalRange;
  const gradId = `rcg-${cfg.key}`;

  function riskAt(x: number): number {
    const floor = 0.04;
    if (x < optLow) {
      const t = (optLow - x) / Math.max(1, optLow - cfg.min);
      return floor + (1 - floor) * Math.pow(t, 1.8);
    }
    if (x > optHigh) {
      const t = (x - optHigh) / Math.max(1, cfg.max - optHigh);
      return floor + (1 - floor) * Math.pow(t, 1.8);
    }
    return floor;
  }

  function toSX(x: number) { return PX + ((x - cfg.min) / (cfg.max - cfg.min)) * plotW; }
  function toSY(r: number) { return PY + (1 - r) * plotH; }

  const pts = Array.from({ length: N + 1 }, (_, i) => {
    const x = cfg.min + (cfg.max - cfg.min) * (i / N);
    return { x, r: riskAt(x) };
  });

  const curvePts = pts.map((p) => `${toSX(p.x).toFixed(1)},${toSY(p.r).toFixed(1)}`).join(" ");
  const bottomY = PY + plotH;

  const areaPath = [
    `M ${PX} ${bottomY}`,
    `L ${PX} ${toSY(pts[0].r).toFixed(1)}`,
    ...pts.map((p) => `L ${toSX(p.x).toFixed(1)} ${toSY(p.r).toFixed(1)}`),
    `L ${W - PX} ${bottomY}`,
    "Z",
  ].join(" ");

  const dotX = toSX(value);
  const dotY = toSY(riskAt(value));

  const optLowPct = Math.max(0, Math.min(100, ((optLow - cfg.min) / (cfg.max - cfg.min)) * 100));
  const optHighPct = Math.max(0, Math.min(100, ((optHigh - cfg.min) / (cfg.max - cfg.min)) * 100));
  const optMidVal = Math.round((optLow + optHigh) / 2);

  const labelAnchor = dotX < PX + 25 ? "start" : dotX > W - PX - 25 ? "end" : "middle";

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0">
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"              stopColor="#ef4444" stopOpacity={0.5} />
          <stop offset={`${optLowPct}%`} stopColor="#22c55e" stopOpacity={0.35} />
          <stop offset={`${optHighPct}%`} stopColor="#22c55e" stopOpacity={0.35} />
          <stop offset="100%"            stopColor="#ef4444" stopOpacity={0.5} />
        </linearGradient>
      </defs>

      {/* Gradient area under curve */}
      <path d={areaPath} fill={`url(#${gradId})`} />

      {/* Risk curve */}
      <polyline points={curvePts} fill="none" stroke="#374151" strokeWidth={1.5} strokeLinejoin="round" />

      {/* X-axis baseline */}
      <line x1={PX} y1={bottomY} x2={W - PX} y2={bottomY} stroke="#e5e7eb" strokeWidth={1} />

      {/* X-axis labels: min | optimal midpoint | max */}
      <text x={PX}     y={H - 3} fontSize={7} fill="#9ca3af" textAnchor="start">{cfg.min}{cfg.unit ? ` ${cfg.unit}` : ""}</text>
      <text x={W / 2}  y={H - 3} fontSize={7} fill="#6b7280" textAnchor="middle">{optMidVal}</text>
      <text x={W - PX} y={H - 3} fontSize={7} fill="#9ca3af" textAnchor="end">{cfg.max}</text>

      {/* Patient drop-line */}
      <line x1={dotX} y1={dotY + 5} x2={dotX} y2={bottomY - 1}
        stroke="#ef4444" strokeWidth={1} strokeDasharray="2.5 2" />

      {/* Patient dot */}
      <circle cx={dotX} cy={dotY} r={4.5} fill="#ef4444" stroke="white" strokeWidth={1.5} />

      {/* Sim label */}
      <text x={dotX} y={dotY - 7} fontSize={7.5} fill="#ef4444"
        textAnchor={labelAnchor} fontWeight="700">
        {value}{cfg.unit ? ` ${cfg.unit}` : ""}
      </text>
    </svg>
  );
}

// ── Factor Row ───────────────────────────────────────────────────────────────

function FactorRow({ cfg, value }: { cfg: SliderConfig; value: number }) {
  const { open, setOpen, ref } = usePopup();
  const meta = FACTOR_META[cfg.key];
  const atRisk = isAtRisk(cfg, value);

  return (
    <div className="flex items-center gap-3">
      <div className="shrink-0 w-36 flex items-start gap-1">
        <span className="text-xs text-gray-600 leading-tight">{cfg.label}</span>
        <div ref={ref} className="relative shrink-0">
          <button onClick={() => setOpen((v) => !v)} className="text-gray-300 hover:text-blue-500 transition-colors">
            <Info size={13} />
          </button>
          {open && (
            <div className="absolute left-0 top-5 z-50 w-72 bg-white border border-gray-200 rounded-2xl shadow-xl p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="text-xs font-semibold text-gray-700">{meta.source}</span>
                <button onClick={() => setOpen(false)}><X size={12} className="text-gray-400 hover:text-gray-600" /></button>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed mb-2">{meta.study}</p>
              <p className="text-[10px] text-gray-400 font-mono">DOI: {meta.doi}</p>
            </div>
          )}
        </div>
      </div>
      <div
        className="shrink-0 w-20 h-12 rounded-xl flex items-center justify-center text-sm font-bold text-white"
        style={{ backgroundColor: atRisk ? "#ef4444" : "#22c55e" }}
      >
        {value}{cfg.unit ? <span className="text-[9px] font-normal ml-0.5">{cfg.unit}</span> : null}
      </div>
      <div className="flex-1 min-w-0">
        <RiskCurveChart cfg={cfg} meta={meta} value={value} />
      </div>
    </div>
  );
}

// ── Slider PDP Mini Curve ────────────────────────────────────────────────────

function SliderPdpCurve({ cfg, value }: { cfg: SliderConfig; value: number }) {
  const meta = FACTOR_META[cfg.key];
  if (!meta) return null;

  const VW = 100, VH = 22, N = 80;
  const PY = 1, axisY = VH, plotH = axisY - PY;
  const [optLow, optHigh] = meta.optimalRange;

  function riskAt(x: number): number {
    const floor = 0.04;
    if (x < optLow) {
      const t = (optLow - x) / Math.max(1, optLow - cfg.min);
      return floor + (1 - floor) * Math.pow(t, 1.8);
    }
    if (x > optHigh) {
      const t = (x - optHigh) / Math.max(1, cfg.max - optHigh);
      return floor + (1 - floor) * Math.pow(t, 1.8);
    }
    return floor;
  }

  function toX(x: number) { return ((x - cfg.min) / (cfg.max - cfg.min)) * VW; }
  function toY(r: number) { return axisY - r * plotH; }

  const pts = Array.from({ length: N + 1 }, (_, i) => {
    const x = cfg.min + (cfg.max - cfg.min) * (i / N);
    return { vx: toX(x), vy: toY(riskAt(x)) };
  });

  const curvePts = pts.map((p) => `${p.vx.toFixed(1)},${p.vy.toFixed(1)}`).join(" ");

  const simX = toX(value);

  return (
    <svg width="100%" height={VH} viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" className="w-full">
      <polyline points={curvePts} fill="none" stroke="#22c55e" strokeWidth="0.9" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity={0.85} />
      <line x1={simX} y1={PY} x2={simX} y2={axisY} stroke="#ef4444" strokeWidth="0.9" vectorEffect="non-scaling-stroke" opacity={0.75} />
    </svg>
  );
}

// ── Slider Row ───────────────────────────────────────────────────────────────

function SliderRow({ cfg, value, baseline, onChange }: {
  cfg: SliderConfig; value: number; baseline: number; onChange: (v: number) => void;
}) {
  const atRisk = isAtRisk(cfg, value);
  const pct = ((value - cfg.min) / (cfg.max - cfg.min)) * 100;
  const baselinePct = ((baseline - cfg.min) / (cfg.max - cfg.min)) * 100;
  const delta = value - baseline;
  const color = atRisk ? "#ef4444" : "#3b82f6";

  if (cfg.isTile) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-600">{cfg.label}</span>
          <span className="text-xs text-gray-400">{cfg.unit}</span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="flex-1 flex items-center rounded-xl border-2 px-3 py-2"
            style={{ borderColor: atRisk ? "#ef4444" : "#e5e7eb" }}
          >
            <input
              type="number" min={cfg.min} max={cfg.max} value={value}
              onChange={(e) => onChange(Math.max(cfg.min, Math.min(cfg.max, Number(e.target.value))))}
              className="w-full text-lg font-bold bg-transparent outline-none tabular-nums"
              style={{ color: atRisk ? "#ef4444" : "#1e293b" }}
            />
          </div>
          <div className="text-xs text-gray-400 text-right leading-tight">
            <div>{cfg.min}–{cfg.max}</div>
            <div>{cfg.unit}</div>
          </div>
        </div>
      </div>
    );
  }

  // Discrete step slider (e.g. prestroke_mrs)
  if (cfg.step && cfg.step >= 1) {
    return null;
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-600">{cfg.label}</span>
        <div className="flex items-center gap-2">
          {delta !== 0 && (
            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-md ${delta < 0 ? "bg-green-100 text-green-600" : "bg-red-100 text-red-500"}`}>
              {delta > 0 ? "+" : ""}{delta} {cfg.unit}
            </span>
          )}
          <span className={`text-sm font-bold tabular-nums ${atRisk ? "text-red-500" : "text-gray-800"}`}>
            {value} <span className="text-xs font-normal text-gray-400">{cfg.unit}</span>
          </span>
        </div>
      </div>
      <SliderPdpCurve cfg={cfg} value={value} />
      <div className="relative flex items-center h-5">
        <div className="absolute w-full h-2 rounded-full bg-gray-100" />
        {delta !== 0 && (() => {
          const left = Math.min(baselinePct, pct);
          const width = Math.abs(pct - baselinePct);
          const barColor = delta > 0 ? "#ef4444" : "#22c55e";
          const riskDelta = Math.round(riskScore(cfg, value) - riskScore(cfg, baseline));
          const midLeft = left + width / 2;
          return (
            <>
              <div
                className="absolute text-[9px] font-bold -top-4 whitespace-nowrap"
                style={{ left: `${midLeft}%`, transform: "translateX(-50%)", color: barColor }}
              >
                {riskDelta > 0 ? "+" : ""}{riskDelta}% risk
              </div>
              <div
                className="absolute h-2 rounded-full transition-all"
                style={{ left: `${left}%`, width: `${width}%`, backgroundColor: barColor, opacity: 0.6 }}
              />
            </>
          );
        })()}
        <div
          className="absolute flex flex-col items-center"
          style={{ left: `${baselinePct}%`, transform: "translateX(-50%)", top: 0 }}
        >
          <div className="w-0.5 h-5 bg-slate-500 rounded-full" />
        </div>
        <input
          type="range" min={cfg.min} max={cfg.max} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="relative w-full h-2 appearance-none bg-transparent cursor-pointer"
          style={{ ["--thumb-color" as string]: color }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-gray-300">
        <span>{cfg.min} {cfg.unit}</span>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-slate-400">
            <span className="inline-block w-0.5 h-3 bg-slate-400 rounded-full" />
            Patient : {baseline} {cfg.unit}
          </span>
          <span className="flex items-center gap-1" style={{ color }}>
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
            Sim : {value} {cfg.unit}
          </span>
        </div>
        <span>{cfg.max} {cfg.unit}</span>
      </div>
    </div>
  );
}

// ── Bool Toggle ──────────────────────────────────────────────────────────────

function BoolToggle({ param, value, onChange }: {
  param: BoolParam; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="flex items-center justify-between gap-2 w-full group"
    >
      <span className="text-xs text-gray-600 text-left leading-tight group-hover:text-gray-800 transition-colors">
        {param.label}
      </span>
      <div
        className="relative shrink-0 inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200"
        style={{ backgroundColor: value ? "#6b7280" : "#d1d5db" }}
      >
        <span
          className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200"
          style={{ transform: value ? "translateX(18px)" : "translateX(2px)" }}
        />
      </div>
    </button>
  );
}

// ── Section Title ────────────────────────────────────────────────────────────

const sectionInfo: Record<string, string> = {
  "Patient Parameters":
    "Adjust each clinical parameter to match the patient's current measurements. Values in red exceed clinically significant thresholds. The risk score and factor chart update in real time.",
  "Factors Contributing to Risk":
    "Each row shows the population distribution for that factor. Dashed blue lines mark clinical thresholds. The coloured dot shows where the patient's value sits — red if above risk threshold, green if within safe range.",
  "Recommendations":
    "Recommendations target parameters with the highest modifiable impact, ranked by projected risk reduction. Click the ℹ icon on each card to read the supporting clinical study.",
};

function SectionTitle({ title }: { title: string }) {
  const { open, setOpen, ref } = usePopup();
  const text = sectionInfo[title];
  return (
    <div className="flex items-center justify-between mb-4 relative shrink-0">
      <span className="text-base font-bold text-gray-700">{title}</span>
      {text && (
        <div ref={ref} className="relative">
          <button onClick={() => setOpen((v) => !v)}>
            <Info size={16} className="text-gray-400 hover:text-gray-600 cursor-pointer" />
          </button>
          {open && (
            <div className="absolute right-0 top-6 z-50 w-72 bg-white border border-gray-200 rounded-2xl shadow-xl p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="text-sm font-semibold text-gray-700">About this section</span>
                <button onClick={() => setOpen(false)}><X size={13} className="text-gray-400 hover:text-gray-600" /></button>
              </div>
              <p className="text-sm text-gray-500 leading-relaxed">{text}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Patient ID Dropdown ───────────────────────────────────────────────────────

function PatientIdDropdown({ selected, onChange }: { selected: string; onChange: (v: string) => void }) {
  const { open, setOpen, ref } = usePopup();
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 font-semibold text-gray-800 hover:text-blue-600 transition-colors text-[14px]"
      >
        {selected}
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-7 z-50 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[90px]">
          {patientIds.map((id) => (
            <button
              key={id}
              onClick={() => { onChange(id); setOpen(false); }}
              className={`w-full text-left px-4 py-1.5 text-sm hover:bg-gray-50 ${id === selected ? "text-blue-600 font-bold" : "text-gray-700"}`}
            >
              {id}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Risk Gauge ───────────────────────────────────────────────────────────────

function RiskGauge({ pct }: { pct: number }) {
  const cx = 80, cy = 80, r = 60;
  const mrs = mrsFromPct(pct);
  const mrsColor = MRS_COLORS[mrs];
  const segSize = 180 / 6;
  const rLabel = r + 13;

  function polarToXY(deg: number) {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
  }

  const needleDeg = 180 - (pct / 100) * 180;
  const needleTip = polarToXY(needleDeg);

  return (
    <div className="flex flex-col items-center">
      <svg width={160} height={95} viewBox="0 0 160 95">
        {MRS_COLORS.map((c, i) => {
          const from = 180 - i * segSize;
          const to = 180 - (i + 1) * segSize;
          const s = polarToXY(from), e = polarToXY(to);
          return (
            <path key={i} d={`M ${s.x} ${s.y} A ${r} ${r} 0 0 0 ${e.x} ${e.y}`}
              fill="none" stroke={c} strokeWidth={14} strokeLinecap="round" />
          );
        })}
        {MRS_COLORS.map((_, i) => {
          const midDeg = 180 - (i + 0.5) * segSize;
          const rad = (midDeg * Math.PI) / 180;
          const lx = cx + rLabel * Math.cos(rad);
          const ly = cy - rLabel * Math.sin(rad);
          return (
            <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
              fontSize={8} fontWeight="600" fill={MRS_COLORS[i]}>{i}</text>
          );
        })}
        <line x1={cx} y1={cy} x2={needleTip.x} y2={needleTip.y} stroke="#1e293b" strokeWidth={3} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={6} fill="#1e293b" />
      </svg>
      <div className="text-center -mt-1">
        <div className="text-xl font-bold" style={{ color: mrsColor }}>mRS {mrs}</div>
        <div className="text-xs text-gray-500 leading-tight">{MRS_LABELS[mrs]}</div>
        <div className="text-[10px] text-gray-400">{pct}% overall risk</div>
      </div>
    </div>
  );
}

// ── Recommendations ──────────────────────────────────────────────────────────

interface Rec { factor: string; current: string; action: string; reduction: string; source: string; study: string; doi: string; }

function parseImpact(reduction: string): number {
  const m = reduction.match(/(\d+)/);
  return m ? parseInt(m[1]) : 0;
}

function pick(m: FactorMeta): { source: string; study: string; doi: string } {
  return { source: m.source, study: m.study, doi: m.doi };
}

function getRecommendations(values: Record<string, number>, boolValues: Record<string, boolean>): Rec[] {
  const recs: Rec[] = [];
  if (values.sysBP > 140)
    recs.push({ factor: "Sys Blood Pressure", current: `${values.sysBP} mmHg`, action: "Target BP < 140 mmHg via medication adjustment", reduction: `~${Math.round((values.sysBP - 140) / 2)}% risk reduction`, ...pick(FACTOR_META.sysBP) });
  if (values.glucose > 126)
    recs.push({ factor: "Glucose", current: `${values.glucose} mg/dL`, action: "Initiate glycaemic control protocol", reduction: "~8% risk reduction", ...pick(FACTOR_META.glucose) });
  if (values.cholesterol > 200)
    recs.push({ factor: "Cholesterol", current: `${values.cholesterol} mg/dL`, action: "Start or intensify statin therapy", reduction: "~11% risk reduction", ...pick(FACTOR_META.cholesterol) });
  if (values.disBP > 90)
    recs.push({ factor: "Dis Blood Pressure", current: `${values.disBP} mmHg`, action: "Target diastolic BP < 90 mmHg", reduction: "~7% risk reduction", ...pick(FACTOR_META.disBP) });
  if (values.onsetToDoor > 120)
    recs.push({ factor: "Onset to Door", current: `${values.onsetToDoor} min`, action: "Improve emergency transport protocol", reduction: "~15% better outcome", ...pick(FACTOR_META.onsetToDoor) });
  if (values.doorToNeedle > 60)
    recs.push({ factor: "Door to Needle", current: `${values.doorToNeedle} min`, action: "Fast-track thrombolysis workflow", reduction: "~12% better outcome", ...pick(FACTOR_META.doorToNeedle) });
  if (values.doorToImaging > 60)
    recs.push({ factor: "Door to Imaging", current: `${values.doorToImaging} min`, action: "Streamline neuroimaging triage protocol", reduction: "~9% better outcome", ...pick(FACTOR_META.doorToImaging) });
  if (!boolValues.prenotification)
    recs.push({ factor: "Pre-notification", current: "Not activated", action: "Activate pre-hospital stroke notification protocol", reduction: "~10% time reduction", source: "ESO Guidelines 2021", study: "Pre-notification of receiving hospital reduces door-to-treatment times significantly, improving patient outcomes in acute stroke management.", doi: "10.1177/23969873211012133" });
  if (!boolValues.imaging_done)
    recs.push({ factor: "Imaging", current: "Not completed", action: "Ensure urgent CT/MRI imaging is performed", reduction: "~18% diagnostic accuracy", source: "AHA/ASA Stroke Guidelines 2019", study: "Early neuroimaging is essential for differentiating ischemic from hemorrhagic stroke, directly influencing treatment eligibility and outcomes.", doi: "10.1161/STR.0000000000000211" });
  if (boolValues.risk_smoker)
    recs.push({ factor: "Smoking", current: "Active smoker", action: "Immediate smoking cessation support", reduction: "~20% stroke risk over 5 years", source: "Bonita et al. (1999) — Stroke", study: "Smoking cessation reduces stroke risk progressively; after 5 years, risk approximates that of non-smokers. Cessation counselling combined with pharmacotherapy doubles quit rates.", doi: "10.1161/01.STR.30.9.1831" });
  if (boolValues.risk_arterialfibrilation)
    recs.push({ factor: "Atrial Fibrillation", current: "Present", action: "Initiate anticoagulation therapy (NOAC/warfarin)", reduction: "~64% stroke risk reduction", source: "Hart et al. (2007) — Ann Intern Med", study: "Adjusted-dose warfarin reduced stroke by 64% vs. placebo in AF patients. NOACs show equivalent or superior efficacy with better safety profiles in large RCTs.", doi: "10.7326/0003-4819-146-12-200706190-00007" });
  return recs.sort((a, b) => parseImpact(b.reduction) - parseImpact(a.reduction));
}

function RecCard({ rec }: { rec: Rec }) {
  const { open, setOpen, ref } = usePopup();
  return (
    <div className="border border-gray-100 rounded-xl p-3 bg-gray-50 shrink-0">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-xs text-gray-400 mb-1">Current Value</p>
          <p className="font-bold text-gray-800 text-sm">{rec.current}</p>
          <span className="text-xs text-blue-600 font-medium">{rec.reduction}</span>
        </div>
        <div className="flex items-start gap-2">
          <div ref={ref} className="relative shrink-0 mt-0.5">
            <button onClick={() => setOpen((v) => !v)} className="text-blue-400 hover:text-blue-600 transition-colors">
              <Info size={14} />
            </button>
            {open && (
              <div className="absolute left-0 top-6 z-50 w-80 bg-white border border-gray-200 rounded-2xl shadow-xl p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-sm font-semibold text-gray-700">{rec.source}</span>
                  <button onClick={() => setOpen(false)}><X size={13} className="text-gray-400 hover:text-gray-600" /></button>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed mb-3">{rec.study}</p>
                <p className="text-[10px] text-gray-400 font-mono">DOI: {rec.doi}</p>
              </div>
            )}
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Factor</p>
            <p className="font-semibold text-gray-700 text-xs">{rec.factor}</p>
          </div>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">Action</p>
          <p className="font-semibold text-gray-700 text-xs">{rec.action}</p>
        </div>
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

const initialValues = Object.fromEntries(SLIDERS.map((s) => [s.key, s.default]));
const initialBools: Record<string, boolean> = {
  risk_hypertension: true,
  risk_diabetes: false,
  risk_smoker: true,
  risk_arterialfibrilation: false,
  prenotification: false,
  hospitalized_in: true,
  bleeding_volume_value: false,
  imaging_done: true,
  occup_physiotherapy_received: false,
  discharge_antiplatlets_any: true,
  Discharge_anticoagulents_any: false,
};

// Sliders that have distribution charts (continuous, non-discrete, not tiles)
const CHART_SLIDERS = SLIDERS.filter((s) => FACTOR_META[s.key]);

export default function App() {
  const [patientId, setPatientId] = useState("1011");
  const [baseline] = useState<Record<string, number>>(initialValues);
  const [values, setValues] = useState<Record<string, number>>(initialValues);
  const [boolValues, setBoolValues] = useState<Record<string, boolean>>(initialBools);

  const risk = overallRisk(values, boolValues);
  const recs = getRecommendations(values, boolValues);

  const patientInfo: [string, React.ReactNode][] = [
    ["Age", "65"], ["Pulse", "80"], ["Region", "Drava"], ["Institution", "01"], ["Gender", "Male"],
  ];

  return (
    <div className="h-screen flex flex-col bg-gray-100 p-4 gap-4 font-sans overflow-hidden">
      <div className="grid grid-cols-12 gap-4 flex-1 min-h-0">

        {/* Left: Patient ID + Factors + Recommendations */}
        <div className="col-span-7 flex flex-col gap-4 min-h-0">

          {/* Patient ID */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-2 shrink-0">
            <div className="flex items-center gap-6 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-gray-400 whitespace-nowrap text-[14px]">Patient ID :</span>
                <PatientIdDropdown selected={patientId} onChange={setPatientId} />
              </div>
              {patientInfo.map(([k, v], i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="text-gray-400 whitespace-nowrap text-[14px]">{k} :</span>
                  <span className="font-semibold text-gray-700 text-[14px]">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Factors */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm flex flex-col flex-1 min-h-0">
            <SectionTitle title="Factors Contributing to Risk" />
            <div className="overflow-y-auto flex-1 flex flex-col gap-3">
              {CHART_SLIDERS.map((cfg) => (
                <FactorRow key={cfg.key} cfg={cfg} value={values[cfg.key]} />
              ))}
            </div>
          </div>

          {/* Recommendations */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm flex flex-col min-h-0" style={{ maxHeight: "38%" }}>
            <SectionTitle title="Recommendations" />
            {recs.length === 0 ? (
              <div className="flex items-center justify-center flex-1 text-sm text-gray-400">
                All parameters within target ranges.
              </div>
            ) : (
              <div className="overflow-y-auto flex-1 flex flex-col gap-2">
                {recs.map((rec, i) => <RecCard key={i} rec={rec} />)}
              </div>
            )}
          </div>
        </div>

        {/* Right: mRS Gauge + Patient Parameters */}
        <div className="col-span-5 flex flex-col gap-4 min-h-0">

          {/* mRS Gauge */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex items-center justify-center px-4 py-2 shrink-0">
            <RiskGauge pct={risk} />
          </div>

          {/* Patient Parameters */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm flex flex-col flex-1 min-h-0">
            <SectionTitle title="Patient Parameters" />
            <div className="overflow-y-auto flex-1 flex flex-col gap-5 pr-1">

              {/* Continuous sliders */}
              {SLIDERS.map((cfg) => (
                <SliderRow
                  key={cfg.key}
                  cfg={cfg}
                  value={values[cfg.key]}
                  baseline={baseline[cfg.key]}
                  onChange={(v) => setValues((prev) => ({ ...prev, [cfg.key]: v }))}
                />
              ))}

              {/* Divider */}
              <div className="border-t border-gray-100 pt-1" />

              {/* Boolean parameters */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                {BOOL_PARAMS.map((p) => (
                  <BoolToggle
                    key={p.key}
                    param={p}
                    value={boolValues[p.key]}
                    onChange={(v) => setBoolValues((prev) => ({ ...prev, [p.key]: v }))}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%;
          background: var(--thumb-color, #3b82f6); border: 2px solid white;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2); cursor: pointer;
        }
        input[type="range"]::-moz-range-thumb {
          width: 16px; height: 16px; border-radius: 50%;
          background: var(--thumb-color, #3b82f6); border: 2px solid white;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2); cursor: pointer;
        }
      `}</style>
    </div>
  );
}