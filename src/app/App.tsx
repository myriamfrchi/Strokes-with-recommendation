import { useState, useRef, useEffect } from "react";
import { Info, ChevronDown, X } from "lucide-react";

// ── Config ───────────────────────────────────────────────────────────────────

const patientIds = ["1011", "1042", "1078", "1095", "1130"];

interface SliderConfig {
  key: string;
  label: string;
  min: number;
  max: number;
  unit: string;
  default: number;
  dangerHigh?: number;
  lowerIsBetter?: boolean;
  isTile?: boolean; // time-based → value tile below slider
}

const SLIDERS: SliderConfig[] = [
  { key: "sysBP",         label: "Sys Blood Pressure",  min: 80,  max: 220, unit: "mmHg", default: 150, dangerHigh: 140 },
  { key: "glucose",       label: "Glucose",              min: 40,  max: 400, unit: "mg/dL",default: 200, dangerHigh: 126 },
  { key: "disBP",         label: "Dis Blood Pressure",   min: 40,  max: 140, unit: "mmHg", default: 95,  dangerHigh: 90 },
  { key: "cholesterol",   label: "Cholesterol",          min: 100, max: 400, unit: "mg/dL",default: 260, dangerHigh: 200 },
  { key: "doorToImagine", label: "Door to Imagine",      min: 0,   max: 180, unit: "min",  default: 45,  dangerHigh: 60,  lowerIsBetter: true, isTile: true },
  { key: "onsetToDoor",   label: "Onset to Door",        min: 0,   max: 600, unit: "min",  default: 180, dangerHigh: 120, lowerIsBetter: true, isTile: true },
  { key: "doorToNeedle",  label: "Door to Needle",       min: 0,   max: 180, unit: "min",  default: 45,  dangerHigh: 60,  lowerIsBetter: true, isTile: true },
];

// Distribution metadata: population mean, std, thresholds, source
interface FactorMeta {
  mean: number; std: number; thresholds: number[];
  source: string; study: string; doi: string;
}

const FACTOR_META: Record<string, FactorMeta> = {
  sysBP: {
    mean: 118, std: 18, thresholds: [120, 140],
    source: "SPRINT Trial (2015) — NEJM",
    study: "The SPRINT Research Group showed intensive systolic BP control (<120 mmHg) reduced major CV events by 25% and all-cause mortality by 27%. Values >140 mmHg are classified Stage 1 hypertension (ACC/AHA 2017 guidelines), conferring a 2× stroke risk increase.",
    doi: "10.1056/NEJMoa1511939",
  },
  glucose: {
    mean: 95, std: 22, thresholds: [100, 126],
    source: "UKPDS 35 (2000) — BMJ",
    study: "Each 1% HbA1c reduction correlates with a 21% drop in diabetes-related deaths and 14% reduction in MI. Fasting glucose >126 mg/dL meets WHO diagnostic threshold for diabetes, independently predicting adverse stroke outcomes and 8% excess CV risk.",
    doi: "10.1136/bmj.321.7258.405",
  },
  disBP: {
    mean: 78, std: 10, thresholds: [80, 90],
    source: "HOT Trial (1998) — Lancet",
    study: "HOT trial (18,790 patients) showed targeting DBP ≤90 mmHg significantly reduced CV events. Diabetic patients at ≤80 mmHg had 51% fewer events. DBP consistently >90 mmHg doubles stroke risk independently of systolic pressure.",
    doi: "10.1016/S0140-6736(98)04311-6",
  },
  cholesterol: {
    mean: 185, std: 38, thresholds: [200, 240],
    source: "CTT Collaboration (2010) — Lancet",
    study: "Meta-analysis of 170,000 participants: each 1 mmol/L LDL-C reduction reduces major vascular events by 22%. Statin therapy in patients with total cholesterol >200 mg/dL yields 11% absolute risk reduction over 5 years in high-risk individuals.",
    doi: "10.1016/S0140-6736(10)61350-5",
  },
  doorToImagine: {
    mean: 28, std: 18, thresholds: [25, 60],
    source: "Minnerup et al. (2012) — Stroke",
    study: "Hospitals with door-to-imaging <25 min achieve thrombolysis rates 3× higher and significantly better 90-day mRS scores. Delays beyond 60 min are independently associated with poorer reperfusion outcomes and a 9% reduction in functional independence at discharge.",
    doi: "10.1161/STROKEAHA.111.648550",
  },
  onsetToDoor: {
    mean: 85, std: 65, thresholds: [60, 120],
    source: "IST-3 Collaborative Group (2012) — Lancet",
    study: "Every 15-minute delay after stroke onset reduces patients with good outcomes by ~1 per 100 treated. Patients treated within 3 hours had OR 1.53 for good outcomes. Pre-hospital notification protocols reduce onset-to-door time by an average of 38 minutes.",
    doi: "10.1016/S0140-6736(12)60768-5",
  },
  doorToNeedle: {
    mean: 42, std: 22, thresholds: [45, 60],
    source: "Fonarow et al. (2011) — JAMA",
    study: "Each 15-min reduction in DTN time reduces in-hospital mortality (OR 0.96), symptomatic ICH, and increases independent ambulation at discharge. Hospitals achieving DTN <60 min had 25% better functional outcomes across 25,504 IV tPA-treated patients.",
    doi: "10.1001/jama.2011.1706",
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function gaussianPDF(x: number, mean: number, std: number) {
  return Math.exp(-0.5 * ((x - mean) / std) ** 2);
}

function isAtRisk(cfg: SliderConfig, val: number) {
  if (cfg.dangerHigh === undefined) return false;
  return cfg.lowerIsBetter ? val > cfg.dangerHigh : val > cfg.dangerHigh;
}

function riskScore(cfg: SliderConfig, val: number) {
  if (cfg.lowerIsBetter) return Math.min(100, (val / cfg.max) * 100);
  return Math.min(100, ((val - cfg.min) / (cfg.max - cfg.min)) * 100);
}

function overallRisk(values: Record<string, number>) {
  return Math.round(SLIDERS.map((s) => riskScore(s, values[s.key])).reduce((a, b) => a + b, 0) / SLIDERS.length);
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

function riskLabel(pct: number) {
  if (pct >= 70) return { label: "High",     color: "#ef4444" };
  if (pct >= 45) return { label: "Moderate", color: "#f97316" };
  return             { label: "mRS 0",    color: "#22c55e" };
}

// ── Popup helper ─────────────────────────────────────────────────────────────

function usePopup() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);
  return { open, setOpen, ref };
}

// ── Distribution Chart ───────────────────────────────────────────────────────

function DistributionChart({ cfg, meta, value }: { cfg: SliderConfig; meta: FactorMeta; value: number }) {
  const W = 220, H = 48, PX = 6, PY = 4;
  const N = 240;

  const pts = Array.from({ length: N + 1 }, (_, i) => {
    const x = cfg.min + (cfg.max - cfg.min) * (i / N);
    const y = gaussianPDF(x, meta.mean, meta.std);
    return { x, y };
  });
  const maxY = Math.max(...pts.map((p) => p.y));
  const baseY = H - PY;

  function toSX(x: number) {
    return PX + ((x - cfg.min) / (cfg.max - cfg.min)) * (W - PX * 2);
  }
  function toSY(y: number) {
    return H - PY - (y / maxY) * (H - PY * 2);
  }
  function toSVG(x: number, y: number) {
    return { sx: toSX(x), sy: toSY(y) };
  }

  // Build zone-colored filled areas clipped between threshold boundaries
  const zones = [
    { from: cfg.min,           to: meta.thresholds[0] ?? cfg.max, color: "#bbf7d0" }, // green
    { from: meta.thresholds[0] ?? cfg.max, to: meta.thresholds[1] ?? cfg.max, color: "#fde68a" }, // yellow
    { from: meta.thresholds[1] ?? cfg.max, to: cfg.max,           color: "#fecaca" }, // red
  ].filter((z) => z.from < z.to && z.from < cfg.max && z.to > cfg.min);

  function zoneAreaPath(xFrom: number, xTo: number) {
    const zonePts = pts.filter((p) => p.x >= xFrom && p.x <= xTo);
    if (zonePts.length === 0) return "";
    const first = toSVG(xFrom, gaussianPDF(xFrom, meta.mean, meta.std));
    const last  = toSVG(xTo,   gaussianPDF(xTo,   meta.mean, meta.std));
    const inner = zonePts.map((p) => `L ${toSX(p.x)} ${toSY(p.y)}`).join(" ");
    return `M ${first.sx} ${baseY} L ${first.sx} ${first.sy} ${inner} L ${last.sx} ${last.sy} L ${last.sx} ${baseY} Z`;
  }

  const linePts = pts.map((p) => `${toSX(p.x)},${toSY(p.y)}`).join(" ");

  const valDensity = gaussianPDF(value, meta.mean, meta.std);
  const { sx: dotX, sy: dotY } = toSVG(value, valDensity);
  const atRisk = isAtRisk(cfg, value);

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0">
      {/* colored zone fills */}
      {zones.map((z, i) => {
        const d = zoneAreaPath(Math.max(z.from, cfg.min), Math.min(z.to, cfg.max));
        return d ? <path key={i} d={d} fill={z.color} opacity={0.7} /> : null;
      })}
      {/* curve line */}
      <polyline points={linePts} fill="none" stroke="#6b7280" strokeWidth={1.5} />
      {/* threshold lines */}
      {meta.thresholds.map((t, i) => {
        if (t <= cfg.min || t >= cfg.max) return null;
        const sx = toSX(t);
        return (
          <g key={i}>
            <line x1={sx} y1={PY} x2={sx} y2={H - PY} stroke="#60a5fa" strokeWidth={1.2} strokeDasharray="3 2" />
            <text x={sx + 2} y={PY + 8} fontSize={7} fill="#3b82f6">{t}</text>
          </g>
        );
      })}
      {/* patient dot */}
      <circle cx={dotX} cy={dotY} r={4} fill={atRisk ? "#ef4444" : "#22c55e"} stroke="white" strokeWidth={1.5} />
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
      {/* label + info */}
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

      {/* value tile */}
      <div
        className="shrink-0 w-16 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white"
        style={{ backgroundColor: atRisk ? "#ef4444" : "#22c55e" }}
      >
        {value}
      </div>

      {/* distribution chart */}
      <div className="flex-1 min-w-0">
        <DistributionChart cfg={cfg} meta={meta} value={value} />
      </div>
    </div>
  );
}

// ── Slider Row ───────────────────────────────────────────────────────────────

function SliderCurve({ cfg }: { cfg: SliderConfig }) {
  if (!FACTOR_META[cfg.key]) return null;
  const N = 80;
  const threshold = cfg.dangerHigh ?? (cfg.min + cfg.max) / 2;
  const range = cfg.max - cfg.min;
  const H = 20;
  // Sigmoid: 0 = safe (curve DOWN), 1 = risky (curve UP)
  const pts = Array.from({ length: N + 1 }, (_, i) => {
    const x = i / N;
    const rx = cfg.min + range * x;
    const t = (rx - threshold) / (range * 0.12);
    const y = 1 / (1 + Math.exp(-t));
    return { px: x * 100, py: H - y * (H - 2) - 1 };
  });
  const polyPts = pts.map((p) => `${p.px},${p.py}`).join(" ");
  return (
    <svg width="100%" height={H} viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="w-full">
      <polyline points={polyPts} fill="none" stroke="#22c55e" strokeWidth="0.9" opacity="0.85" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

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

  return (
    <div className="flex flex-col gap-0.5">
      {/* Label row */}
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

      {/* Green distribution curve */}
      <SliderCurve cfg={cfg} />

      {/* Track + markers */}
      <div className="relative flex items-center h-5">
        {/* track bg */}
        <div className="absolute w-full h-2 rounded-full bg-gray-100" />
        {/* risk delta bar between baseline and current */}
        {delta !== 0 && (() => {
          const left     = Math.min(baselinePct, pct);
          const width    = Math.abs(pct - baselinePct);
          const barColor = delta > 0 ? "#ef4444" : "#22c55e";
          const riskDelta = Math.round(riskScore(cfg, value) - riskScore(cfg, baseline));
          const midLeft  = left + width / 2;
          return (
            <>
              {/* percentage label above the bar */}
              <div
                className="absolute text-[9px] font-bold -top-4 whitespace-nowrap"
                style={{ left: `${midLeft}%`, transform: "translateX(-50%)", color: barColor }}
              >
                {riskDelta > 0 ? "+" : ""}{riskDelta}% risk
              </div>
              {/* colored bar */}
              <div
                className="absolute h-2 rounded-full transition-all"
                style={{ left: `${left}%`, width: `${width}%`, backgroundColor: barColor, opacity: 0.6 }}
              />
            </>
          );
        })()}
        {/* baseline marker */}
        <div
          className="absolute flex flex-col items-center"
          style={{ left: `${baselinePct}%`, transform: "translateX(-50%)", top: 0 }}
        >
          <div className="w-0.5 h-5 bg-slate-500 rounded-full" />
        </div>
        {/* slider thumb */}
        <input
          type="range" min={cfg.min} max={cfg.max} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="relative w-full h-2 appearance-none bg-transparent cursor-pointer"
          style={{ ["--thumb-color" as string]: color }}
        />
      </div>

      {/* Legend row */}
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

// ── Info Popup (section title) ───────────────────────────────────────────────

const sectionInfo: Record<string, string> = {
  "Patient Parameters":
    "Adjust each clinical parameter to match the patient's current measurements. Values in red exceed clinically significant thresholds. The risk score and factor chart update in real time.",
  "Factors Contributing to Risk":
    "Each row shows the population distribution for that factor. Dashed blue lines mark clinical thresholds. The coloured dot shows where the patient's value sits — red if above risk threshold, green if within safe range.",
  "Recommendations to reduce the risk":
    "Recommendations target parameters with the highest modifiable impact, ranked by projected risk reduction. Click the ℹ️ on each card to read the supporting clinical study.",
};

function SectionTitle({ title }: { title: string }) {
  const { open, setOpen, ref } = usePopup();
  const text = sectionInfo[title];
  return (
    <div className="flex items-center justify-between mb-4 relative">
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
      <button onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 font-semibold text-gray-800 hover:text-blue-600 transition-colors text-[14px]">
        {selected}
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-7 z-50 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[90px]">
          {patientIds.map((id) => (
            <button key={id} onClick={() => { onChange(id); setOpen(false); }}
              className={`w-full text-left px-4 py-1.5 text-sm hover:bg-gray-50 ${id === selected ? "text-blue-600 font-bold" : "text-gray-700"}`}>
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

  function polarToXY(deg: number) {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
  }
  // 6 arcs for mRS 0-5 (each = 30°)
  const arcColors = MRS_COLORS;
  function arc(from: number, to: number, c: string) {
    const s = polarToXY(from), e = polarToXY(to);
    return <path d={`M ${s.x} ${s.y} A ${r} ${r} 0 0 ${from > to ? 0 : 1} ${e.x} ${e.y}`}
      fill="none" stroke={c} strokeWidth={14} strokeLinecap="round" />;
  }

  const needleDeg = 180 - (pct / 100) * 180;
  const needleTip = polarToXY(needleDeg);

  // Label each arc segment at its midpoint
  const segSize = 180 / 6;
  const rLabel = r + 13;

  return (
    <div className="flex flex-col items-center">
      <svg width={160} height={95} viewBox="0 0 160 95">
        {arcColors.map((c, i) => {
          const from = 180 - i * segSize;
          const to   = 180 - (i + 1) * segSize;
          const s = polarToXY(from), e = polarToXY(to);
          return (
            <path key={i} d={`M ${s.x} ${s.y} A ${r} ${r} 0 0 0 ${e.x} ${e.y}`}
              fill="none" stroke={c} strokeWidth={14} strokeLinecap="round" />
          );
        })}
        {/* mRS tick labels */}
        {arcColors.map((_, i) => {
          const midDeg = 180 - (i + 0.5) * segSize;
          const rad = (midDeg * Math.PI) / 180;
          const lx = cx + rLabel * Math.cos(rad);
          const ly = cy - rLabel * Math.sin(rad);
          return (
            <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
              fontSize={8} fontWeight="600" fill={MRS_COLORS[i]}>
              {i}
            </text>
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

function getRecommendations(values: Record<string, number>): Rec[] {
  const recs: Rec[] = [];
  if (values.sysBP > 140) recs.push({ factor: "Sys Blood Pressure", current: `${values.sysBP} mmHg`, action: "Target BP < 140 mmHg via medication adjustment", reduction: `~${Math.round((values.sysBP - 140) / 2)}% risk reduction`, ...pick(FACTOR_META.sysBP) });
  if (values.glucose > 126) recs.push({ factor: "Glucose", current: `${values.glucose} mg/dL`, action: "Initiate glycaemic control protocol", reduction: "~8% risk reduction", ...pick(FACTOR_META.glucose) });
  if (values.cholesterol > 200) recs.push({ factor: "Cholesterol", current: `${values.cholesterol} mg/dL`, action: "Start or intensify statin therapy", reduction: "~11% risk reduction", ...pick(FACTOR_META.cholesterol) });
  if (values.disBP > 90) recs.push({ factor: "Dis Blood Pressure", current: `${values.disBP} mmHg`, action: "Target diastolic BP < 90 mmHg", reduction: "~7% risk reduction", ...pick(FACTOR_META.disBP) });
  if (values.onsetToDoor > 120) recs.push({ factor: "Onset to Door", current: `${values.onsetToDoor} min`, action: "Improve emergency transport protocol", reduction: "~15% better outcome", ...pick(FACTOR_META.onsetToDoor) });
  if (values.doorToNeedle > 60) recs.push({ factor: "Door to Needle", current: `${values.doorToNeedle} min`, action: "Fast-track thrombolysis workflow", reduction: "~12% better outcome", ...pick(FACTOR_META.doorToNeedle) });
  if (values.doorToImagine > 60) recs.push({ factor: "Door to Imagine", current: `${values.doorToImagine} min`, action: "Streamline neuroimaging triage protocol", reduction: "~9% better outcome", ...pick(FACTOR_META.doorToImagine) });
  return recs.sort((a, b) => parseImpact(b.reduction) - parseImpact(a.reduction));
}

function pick(m: FactorMeta): { source: string; study: string; doi: string } {
  return { source: m.source, study: m.study, doi: m.doi };
}

function RecCard({ rec }: { rec: Rec }) {
  const { open, setOpen, ref } = usePopup();
  return (
    <div className="border border-gray-100 rounded-xl p-4 bg-gray-50 shrink-0">
      <div className="grid grid-cols-3 gap-4">
        {/* Current Value — left */}
        <div>
          <p className="text-xs text-gray-400 mb-1">Current Value</p>
          <p className="font-bold text-gray-800 text-base">{rec.current}</p>
          <span className="text-sm text-blue-600 font-medium">{rec.reduction}</span>
        </div>
        {/* Factor + info icon */}
        <div className="flex items-start gap-2">
          <div ref={ref} className="relative shrink-0 mt-0.5">
            <button onClick={() => setOpen((v) => !v)} className="text-blue-400 hover:text-blue-600 transition-colors">
              <Info size={16} />
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
            <p className="font-semibold text-gray-700 text-sm">{rec.factor}</p>
          </div>
        </div>
        {/* Action */}
        <div>
          <p className="text-xs text-gray-400 mb-1">Action</p>
          <p className="font-semibold text-gray-700 text-sm">{rec.action}</p>
        </div>
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

const initialValues = Object.fromEntries(SLIDERS.map((s) => [s.key, s.default]));

export default function App() {
  const [patientId, setPatientId] = useState("1011");
  const [baseline] = useState<Record<string, number>>(initialValues); // factual patient data, fixed
  const [values, setValues] = useState<Record<string, number>>(initialValues);

  const risk = overallRisk(values);
  const recs = getRecommendations(values);

  const patientInfo: [string, React.ReactNode][] = [
    ["Age", "65"], ["Pulse", "80"], ["Region", "Drava"], ["Institution", "01"], ["Gender", "Male"],
    ["Diabetes", <span key="db" className="text-red-500 font-semibold">Yes</span>],
    ["Smoking Status", <span key="ss" className="text-orange-500 font-semibold">Active</span>],
  ];

  return (
    <div className="h-screen flex flex-col bg-gray-100 p-4 gap-4 font-sans overflow-hidden">

      {/* Main grid */}
      <div className="grid grid-cols-12 gap-4 flex-1 min-h-0">

        {/* Left: Factors + Recommendations */}
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
              {SLIDERS.map((cfg) => (
                <FactorRow key={cfg.key} cfg={cfg} value={values[cfg.key]} />
              ))}
            </div>
          </div>

          {/* Recommendations */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm flex flex-col flex-1 min-h-0">
            <SectionTitle title="Recommendations to reduce the risk" />
            <div className="grid grid-cols-3 text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100 pb-2 mb-3 px-1">
              <span>Current Value</span><span>Factor</span><span>Action</span>
            </div>
            {recs.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                All parameters within safe ranges — no recommendations.
              </div>
            ) : (
              <div className="overflow-y-auto flex-1 flex flex-col gap-3 pr-1">
                {recs.map((rec, i) => <RecCard key={i} rec={rec} />)}
              </div>
            )}
          </div>
        </div>

        {/* Right: Patient Parameters */}
        <div className="col-span-5 flex flex-col gap-4 min-h-0">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex items-center justify-center px-4 py-2 m-[0px]">
            <RiskGauge pct={risk} />
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm flex flex-col flex-1 min-h-0">
            <SectionTitle title="Patient Parameters" />
            <div className="overflow-y-auto flex-1 flex flex-col gap-5 pr-1">
              {SLIDERS.map((cfg) => (
                <SliderRow key={cfg.key} cfg={cfg} value={values[cfg.key]} baseline={baseline[cfg.key]}
                  onChange={(v) => setValues((prev) => ({ ...prev, [cfg.key]: v }))} />
              ))}
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
