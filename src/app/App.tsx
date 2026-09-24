import { useState, useRef, useEffect } from "react";
import { Info, ChevronDown, X } from "lucide-react";

// ── Config ───────────────────────────────────────────────────────────────────

const patientIds = ["dfngrvjkictscmy", "uznrjkmtisetxsg", "azexpgpszpmglxf", "uthjemmvtwogzcc", "mcnjbkdjdsycrjf", "xvyeentnlfrcyyx"];

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
  { key: "cholesterol",    label: "Cholesterol",         min: 50,  max: 400, unit: "mg/dL", default: 260, dangerHigh: 200 },
  { key: "prestrokeMrs",   label: "Pre-stroke mRS",      min: 0,   max: 5,   unit: "",      default: 2,   dangerHigh: 2,  step: 1, noChart: true },
  { key: "doorToImaging",  label: "Door to Imaging",     min: 0,   max: 180, unit: "min",   default: 45,  dangerHigh: 60, lowerIsBetter: true, isTile: true },
  { key: "onsetToDoor",    label: "Onset to Door",       min: 0,   max: 600, unit: "min",   default: 180, dangerHigh: 120, lowerIsBetter: true, isTile: true },
  { key: "doorToNeedle",   label: "Door to Needle",      min: 0,   max: 180, unit: "min",   default: 45,  dangerHigh: 60, lowerIsBetter: true, isTile: true },
];

const BOOL_PARAMS: BoolParam[] = [
  { key: "risk_hypertension",          label: "Hypertension",            group: "Risk Factors", riskIfTrue: true },
  { key: "risk_diabetes",              label: "Diabetes",                group: "Risk Factors", riskIfTrue: true },
  { key: "risk_smoker",                label: "Smoker",                  group: "Risk Factors", riskIfTrue: true },
  { key: "prenotification",            label: "Pre-notification",        group: "Clinical",     riskIfTrue: false },
  { key: "hospitalized_in",            label: "Hospitalized In",         group: "Clinical",     riskIfTrue: false },
  { key: "bleeding_volume_value",      label: "Bleeding Volume",         group: "Clinical",     riskIfTrue: true },
  { key: "imaging_done",               label: "Imaging Done",            group: "Clinical",     riskIfTrue: false },
  { key: "occup_physiotherapy_received", label: "Physiotherapy",         group: "Discharge",    riskIfTrue: false },
  { key: "discharge_antiplatlets_any", label: "Antiplatelets",           group: "Discharge",    riskIfTrue: false },
  { key: "Discharge_anticoagulents_any", label: "Anticoagulants",        group: "Discharge",    riskIfTrue: false },
];

// Fallback shown only until the API answers — never passed off as patient data.
const initialValues = Object.fromEntries(SLIDERS.map((s) => [s.key, s.default]));
const initialBools: Record<string, boolean> = Object.fromEntries(
  BOOL_PARAMS.map((p) => [p.key, false]),
);

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

// ── API connection ───────────────────────────────────────────────────────────

const API_BASE = String(
  (import.meta as any).env?.VITE_API_URL ?? "http://127.0.0.1:8000",
).replace(/\/+$/, "");

type ApiRecord = Record<string, unknown>;

/** Returns the first of `names` the payload actually carries a value for. */
function readField(raw: ApiRecord, names: string[]): unknown {
  for (const name of names) {
    const v = raw[name];
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    return v;
  }
  return undefined;
}

function toNumber(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

const TRUE_WORDS = new Set(["1", "true", "yes", "y", "oui", "done", "received", "present"]);
const FALSE_WORDS = new Set(["0", "false", "no", "n", "non", "none", "absent", "recommended"]);

/** The registry sends "0" / "1" as strings, and Boolean("0") is true — so every
 *  flag has to go through this instead of a plain cast. */
function toBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v > 0 : undefined;
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  if (s === "") return undefined;
  if (TRUE_WORDS.has(s)) return true;
  if (FALSE_WORDS.has(s)) return false;
  const n = Number(s);
  return Number.isFinite(n) ? n > 0 : undefined;
}

/** The registry stores glucose and cholesterol in mmol/L, while this UI — its
 *  thresholds, optimal ranges and the studies behind them — is in mg/dL. The
 *  conversion only fires inside the plausible mmol/L band, so an API that
 *  already sends mg/dL keeps working untouched. */
function glucoseToMgdl(v: number) { return v < 50 ? v * 18.0182 : v; }
function cholesterolToMgdl(v: number) { return v < 20 ? v * 38.665 : v; }

/** Maps the payload onto the slider keys. The API serves the registry's
 *  snake_case column names; without this table only `glucose` and
 *  `cholesterol` lined up by name and every other factor silently kept its
 *  hardcoded default. */
/** Colonne du registre correspondant a chaque cle de l'interface. */
const API_COLUMN: Record<string, string> = {
  sysBP: "sys_blood_pressure", disBP: "dis_blood_pressure",
  glucose: "glucose", cholesterol: "cholesterol", prestrokeMrs: "prestroke_mrs",
  doorToImaging: "door_to_imaging", onsetToDoor: "onset_to_door",
  doorToNeedle: "door_to_needle",
};

/** Retour vers l'unite du registre : l'ecran affiche des mg/dL convertis, mais
 *  le modele a ete entraine sur les mmol/L bruts. Sans ca, une glycemie simulee
 *  serait decoupee avec les mauvais seuils. */
const VERS_REGISTRE: Record<string, (v: number) => number> = {
  glucose: (v) => v / 18.0182,
  cholesterol: (v) => v / 38.665,
};

function versRegistre(key: string, valeur: number) {
  const f = VERS_REGISTRE[key];
  return f ? f(valeur) : valeur;
}

const NUMERIC_SOURCES: Record<string, { from: string[]; convert?: (v: number) => number }> = {
  sysBP:         { from: ["sys_blood_pressure", "sysBP"] },
  disBP:         { from: ["dis_blood_pressure", "disBP"] },
  glucose:       { from: ["glucose"], convert: glucoseToMgdl },
  cholesterol:   { from: ["cholesterol"], convert: cholesterolToMgdl },
  prestrokeMrs:  { from: ["prestroke_mrs", "prestrokeMrs"] },
  doorToImaging: { from: ["door_to_imaging", "doorToImaging"] },
  onsetToDoor:   { from: ["onset_to_door", "onsetToDoor"] },
  doorToNeedle:  { from: ["door_to_needle", "doorToNeedle"] },
};

const ANTIPLATELETS = [
  "discharge_clopidrogel", "discharge_prasugrel", "discharge_ticagrelor",
  "discharge_ticlopidine", "discharge_cilostazol", "discharge_dipyridamol",
];
const ANTICOAGULANTS = [
  "discharge_apixaban", "discharge_dabigatran", "discharge_edoxaban",
  "discharge_rivaroxaban", "discharge_warfarin", "discharge_heparin",
];

/** True as soon as one drug of the family is flagged; undefined while none of
 *  them is known, so an unknown family keeps its fallback instead of "off". */
function anyDrug(raw: ApiRecord, columns: string[]): boolean | undefined {
  let known = false;
  for (const c of columns) {
    const b = toBool(raw[c]);
    if (b === undefined) continue;
    known = true;
    if (b) return true;
  }
  return known ? false : undefined;
}

const BOOL_SOURCES: Record<string, (raw: ApiRecord) => boolean | undefined> = {
  risk_hypertension: (r) => toBool(readField(r, ["risk_hypertension"])),
  risk_diabetes:     (r) => toBool(readField(r, ["risk_diabetes"])),
  risk_smoker:       (r) => toBool(readField(r, ["risk_smoker"])),
  prenotification:   (r) => toBool(readField(r, ["prenotification"])),
  // Categorical in the registry ("ICU/stroke unit" | "monitored bed" |
  // "standard bed"): the toggle means "admitted to a stroke unit".
  hospitalized_in: (r) => {
    const v = readField(r, ["hospitalized_in"]);
    if (v === undefined) return undefined;
    const s = String(v).toLowerCase();
    return s.includes("stroke unit") || s.includes("icu");
  },
  // Stored as a volume in mL, not as a flag.
  bleeding_volume_value: (r) => {
    const n = toNumber(readField(r, ["bleeding_volume_value"]));
    return n === undefined ? undefined : n > 0;
  },
  imaging_done:                 (r) => toBool(readField(r, ["imaging_done"])),
  occup_physiotherapy_received: (r) => toBool(readField(r, ["occup_physiotherapy_received"])),
  // The registry has no aggregate column for either family, so these are
  // derived from the individual discharge drugs — the same six columns the
  // modelling notebooks fold into `anticoagulant_discharge` via max(axis=1).
  // An API already exposing an aggregate, under any of these names, wins.
  discharge_antiplatlets_any: (r) => {
    const direct = toBool(readField(r, [
      "discharge_antiplatlets_any", "discharge_antiplatelets_any", "antiplatelet_discharge",
    ]));
    return direct !== undefined ? direct : anyDrug(r, ANTIPLATELETS);
  },
  Discharge_anticoagulents_any: (r) => {
    const direct = toBool(readField(r, [
      "Discharge_anticoagulents_any", "discharge_anticoagulents_any",
      "discharge_anticoagulants_any", "anticoagulant_discharge",
    ]));
    return direct !== undefined ? direct : anyDrug(r, ANTICOAGULANTS);
  },
};

function clampToRange(cfg: SliderConfig, v: number) {
  const clamped = Math.max(cfg.min, Math.min(cfg.max, v));
  const step = cfg.step ?? 1;
  // Keeps the value on the grid the input accepts, so what the slider reports
  // back and what the tiles display can never drift apart.
  return Number((Math.round(clamped / step) * step).toFixed(6));
}

interface MappedPatient {
  values: Record<string, number>;
  bools: Record<string, boolean>;
}

function mapPatient(raw: ApiRecord): MappedPatient {
  const values: Record<string, number> = { ...initialValues };
  const bools: Record<string, boolean> = { ...initialBools };

  for (const cfg of SLIDERS) {
    const src = NUMERIC_SOURCES[cfg.key];
    const n = src ? toNumber(readField(raw, src.from)) : undefined;
    if (n === undefined) continue;   // keep the fallback for this key
    values[cfg.key] = clampToRange(cfg, src.convert ? src.convert(n) : n);
  }

  for (const p of BOOL_PARAMS) {
    const b = BOOL_SOURCES[p.key]?.(raw);
    if (b !== undefined) bools[p.key] = b;
  }

  return { values, bools };
}

// ── Explication SHAP renvoyee par le modele ──────────────────────────────────

interface ShapPoint { classe: number; shap: number; mrs: number }

interface ShapVariable {
  label: string;
  unite: string;
  valeur_brute: number | null;
  classe_actuelle: number | null;
  seuils: number[];
  libelles_classes: string[];
  shap_actuel: number;
  courbe: ShapPoint[];
}

interface Explication {
  patient: string;
  simule: boolean;
  prediction: { mrs: number; valeur_base: number };
  variables: Record<string, ShapVariable>;
}

// ── Patient selection, kept across reloads ───────────────────────────────────

const PATIENT_STORAGE_KEY = "swr.patientId";

/** A reload keeps the patient that was on screen: ?patient= wins, then the
 *  last selection, then the first id of the list. */
function readInitialPatientId(): string {
  if (typeof window === "undefined") return patientIds[0];
  const fromUrl = new URLSearchParams(window.location.search).get("patient");
  if (fromUrl) return fromUrl;
  try {
    const stored = window.localStorage.getItem(PATIENT_STORAGE_KEY);
    if (stored) return stored;
  } catch { /* storage unavailable (private mode) */ }
  return patientIds[0];
}

function rememberPatientId(id: string) {
  try { window.localStorage.setItem(PATIENT_STORAGE_KEY, id); } catch { /* ignore */ }
  const url = new URL(window.location.href);
  if (url.searchParams.get("patient") !== id) {
    url.searchParams.set("patient", id);
    window.history.replaceState(null, "", url);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAtRisk(cfg: SliderConfig, val: number) {
  if (cfg.dangerHigh === undefined) return false;
  return val > cfg.dangerHigh;
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

// ── Courbe SHAP (dependance partielle issue du modele) ───────────────────────

/** Conversion inverse de `versRegistre` : les seuils renvoyes par l'API sont
 *  dans l'unite du registre, l'axe du graphe est dans celle de l'ecran. */
const DEPUIS_REGISTRE: Record<string, (v: number) => number> = {
  glucose: (v) => v * 18.0182,
  cholesterol: (v) => v * 38.665,
};

function depuisRegistre(key: string, valeur: number) {
  const f = DEPUIS_REGISTRE[key];
  return f ? f(valeur) : valeur;
}

/** Decoupe l'axe en segments [debut, fin] portant chacun la valeur SHAP de sa
 *  classe. Un seuil hors de l'axe est simplement ignore : la classe couvre
 *  alors toute la largeur, ce qui est exactement ce que dit le modele. */
function segments(cfg: SliderConfig, variable: ShapVariable) {
  const seuils = variable.seuils
    .map((b) => depuisRegistre(cfg.key, b))
    .filter((b) => b > cfg.min && b < cfg.max);
  const bornes = [cfg.min, ...seuils, cfg.max];

  return variable.courbe.slice(0, bornes.length - 1).map((pt, i) => ({
    debut: bornes[i],
    fin: bornes[i + 1],
    shap: pt.shap,
    classe: pt.classe,
  }));
}

/** Trace lisse : palier horizontal par classe, puis transition en S centree sur
 *  le seuil au lieu d'un angle droit. Chaque palier garde sa valeur SHAP exacte
 *  et chaque bascule reste sur son seuil ; seule la marche est adoucie, sur une
 *  largeur volontairement etroite pour ne pas suggerer une pente continue. */
function tracéLisse(
  paliers: { x0: number; x1: number; y: number }[],
  largeurMax: number,
) {
  if (paliers.length === 0) return "";
  const d = [`M ${paliers[0].x0.toFixed(1)} ${paliers[0].y.toFixed(1)}`];
  for (let i = 1; i < paliers.length; i++) {
    const seuil = paliers[i].x0;
    const avant = paliers[i - 1];
    // la transition ne doit jamais deborder sur le palier voisin
    const w = Math.max(0.5, Math.min(largeurMax,
      (seuil - avant.x0) / 2, (paliers[i].x1 - seuil) / 2));
    d.push(`L ${(seuil - w).toFixed(1)} ${avant.y.toFixed(1)}`);
    d.push(`C ${seuil.toFixed(1)} ${avant.y.toFixed(1)}, `
         + `${seuil.toFixed(1)} ${paliers[i].y.toFixed(1)}, `
         + `${(seuil + w).toFixed(1)} ${paliers[i].y.toFixed(1)}`);
  }
  const dernier = paliers[paliers.length - 1];
  d.push(`L ${dernier.x1.toFixed(1)} ${dernier.y.toFixed(1)}`);
  return d.join(" ");
}

/** Courbe lisse de dependance partielle.
 *  C'est la forme honnete d'un graphe de dependance partielle sur une variable
 *  discretisee — le modele ne change d'avis qu'au franchissement d'un seuil. */
function ShapCurveChart({ cfg, variable, value }: {
  cfg: SliderConfig; variable: ShapVariable; value: number;
}) {
  const W = 220, H = 72, PX = 10, PY = 10, BAS = 12;
  const plotH = H - PY - BAS;
  const segs = segments(cfg, variable);

  const ampli = Math.max(0.02, ...segs.map((s) => Math.abs(s.shap)));
  const zeroY = PY + plotH / 2;
  const toX = (v: number) => PX + ((v - cfg.min) / (cfg.max - cfg.min)) * (W - PX * 2);
  const toY = (shap: number) => zeroY - (shap / ampli) * (plotH / 2);

  const paliers = segs.map((seg) => ({
    x0: toX(seg.debut), x1: toX(seg.fin), y: toY(seg.shap),
  }));
  const trace = tracéLisse(paliers, 13);
  // meme trace referme sur la ligne du zero, pour l'aire
  const aire = `${trace} L ${paliers[paliers.length - 1].x1.toFixed(1)} ${zeroY.toFixed(1)}`
             + ` L ${paliers[0].x0.toFixed(1)} ${zeroY.toFixed(1)} Z`;
  const gradId = `pdp-${cfg.key}`;

  const courant = segs.find((s) => s.classe === variable.classe_actuelle) ?? segs[0];
  const xPatient = toX(Math.max(cfg.min, Math.min(cfg.max, value)));
  const yPatient = courant ? toY(courant.shap) : zeroY;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0">
      {/* aire sous la courbe, teintee par le signe de l'effet sur chaque palier */}
      <defs>
        <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={PX} x2={W - PX}>
          {segs.flatMap((seg) => {
            const c = seg.shap >= 0 ? "#ef4444" : "#22c55e";
            const o0 = (toX(seg.debut) - PX) / (W - PX * 2);
            const o1 = (toX(seg.fin) - PX) / (W - PX * 2);
            return [
              <stop key={`${seg.classe}a`} offset={o0} stopColor={c} />,
              <stop key={`${seg.classe}b`} offset={o1} stopColor={c} />,
            ];
          })}
        </linearGradient>
      </defs>
      <path d={aire} fill={`url(#${gradId})`} opacity={0.16} />

      <line x1={PX} y1={zeroY} x2={W - PX} y2={zeroY} stroke="#e5e7eb" strokeWidth={1} />

      {/* seuils : la ou le modele bascule. L'etiquette n'apparait que si elle a
          la place — sinon elle se superpose aux bornes de l'axe ou a sa voisine. */}
      {segs.slice(1).map((seg, i) => {
        const x = toX(seg.debut);
        const precedent = i > 0 ? toX(segs[i].debut) : -Infinity;
        const lisible = x - PX > 30 && (W - PX) - x > 20 && x - precedent > 14;
        return (
          <g key={`s${seg.classe}`}>
            <line x1={x} y1={PY} x2={x} y2={PY + plotH}
              stroke="#cbd5e1" strokeWidth={1} strokeDasharray="2 2" />
            {lisible && (
              <text x={x} y={H - 2} fontSize={6.5} fill="#64748b"
                textAnchor="middle" fontWeight="600">
                {Math.round(seg.debut)}
              </text>
            )}
          </g>
        );
      })}

      <path d={trace} fill="none" stroke="#374151" strokeWidth={1.6}
        strokeLinejoin="round" strokeLinecap="round" />

      {/* position du patient */}
      <line x1={xPatient} y1={yPatient} x2={xPatient} y2={PY + plotH}
        stroke="#ef4444" strokeWidth={1} strokeDasharray="2.5 2" />
      <circle cx={xPatient} cy={yPatient} r={4} fill="#ef4444" stroke="white" strokeWidth={1.5} />
      <text x={xPatient} y={yPatient - 6 < PY + 6 ? yPatient + 11 : yPatient - 6}
        fontSize={7.5} fontWeight="700" fill="#ef4444"
        textAnchor={xPatient < PX + 28 ? "start" : xPatient > W - PX - 28 ? "end" : "middle"}>
        {courant ? `${courant.shap > 0 ? "+" : ""}${courant.shap.toFixed(2)}` : ""}
      </text>

      <text x={PX} y={H - 2} fontSize={6.5} fill="#9ca3af" textAnchor="start">
        {cfg.min}{cfg.unit ? ` ${cfg.unit}` : ""}
      </text>
      <text x={W - PX} y={H - 2} fontSize={6.5} fill="#9ca3af" textAnchor="end">{cfg.max}</text>
      <text x={PX} y={PY - 3} fontSize={6} fill="#9ca3af" textAnchor="start">
        effet SHAP sur le mRS
      </text>
    </svg>
  );
}

// ── Factor Row ───────────────────────────────────────────────────────────────

function FactorRow({ cfg, value, variable }: {
  cfg: SliderConfig; value: number; variable?: ShapVariable;
}) {
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
        {variable
          ? <ShapCurveChart cfg={cfg} variable={variable} value={value} />
          : <div className="h-[72px] flex items-center text-[10px] text-gray-300">
              en attente du modele…
            </div>}
      </div>
    </div>
  );
}

// ── Mini courbe SHAP sous le curseur ─────────────────────────────────────────

function SliderShapCurve({ cfg, variable }: {
  cfg: SliderConfig; variable: ShapVariable | undefined;
}) {
  if (!variable) return null;
  const VW = 100, VH = 22, PY = 2;
  const segs = segments(cfg, variable);
  const ampli = Math.max(0.02, ...segs.map((s) => Math.abs(s.shap)));
  const zeroY = PY + (VH - PY * 2) / 2;
  const toX = (v: number) => ((v - cfg.min) / (cfg.max - cfg.min)) * VW;
  const toY = (shap: number) => zeroY - (shap / ampli) * ((VH - PY * 2) / 2);

  const trace = tracéLisse(
    segs.map((seg) => ({ x0: toX(seg.debut), x1: toX(seg.fin), y: toY(seg.shap) })),
    6,
  );

  return (
    <svg width="100%" height={VH} viewBox={`0 0 ${VW} ${VH}`}
      preserveAspectRatio="none" className="w-full">
      <line x1={0} y1={zeroY} x2={VW} y2={zeroY} stroke="#e5e7eb"
        strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
      <path d={trace} fill="none" stroke="#22c55e" strokeWidth="0.9"
        strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity={0.85} />
    </svg>
  );
}

// ── Slider Row ───────────────────────────────────────────────────────────────

function SliderRow({ cfg, value, baseline, onChange, variable, variableBase }: {
  cfg: SliderConfig; value: number; baseline: number;
  onChange: (v: number) => void;
  variable?: ShapVariable; variableBase?: ShapVariable;
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
              type="number" min={cfg.min} max={cfg.max} step={cfg.step ?? 1} value={value}
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

  // Discrete parameters have no control of their own; the header shows them.
  if (cfg.step && cfg.step >= 1) return null;

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
      <SliderShapCurve cfg={cfg} variable={variable} />
      <div className="relative flex items-center h-5">
        <div className="absolute w-full h-2 rounded-full bg-gray-100" />
        {delta !== 0 && (() => {
          const left = Math.min(baselinePct, pct);
          const width = Math.abs(pct - baselinePct);
          const barColor = delta > 0 ? "#ef4444" : "#22c55e";
          // Ecart d'effet mesure par le modele, pas une regle inventee.
          const ecartShap = variable && variableBase
            ? variable.shap_actuel - variableBase.shap_actuel : null;
          const midLeft = left + width / 2;
          return (
            <>
              <div
                className="absolute text-[9px] font-bold -top-4 whitespace-nowrap"
                style={{ left: `${midLeft}%`, transform: "translateX(-50%)", color: barColor }}
              >
                {ecartShap === null
                  ? ""
                  : `${ecartShap > 0 ? "+" : ""}${ecartShap.toFixed(2)} mRS`}
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
          type="range" min={cfg.min} max={cfg.max} step={cfg.step ?? 1} value={value}
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

/** `mrs` est la sortie du modele (continue). L'aiguille suit la valeur exacte,
 *  le libelle affiche la classe arrondie. */
function RiskGauge({ mrs: brut, enAttente }: { mrs: number | null; enAttente: boolean }) {
  const cx = 80, cy = 80, r = 60;
  const valeur = brut ?? 0;
  const pct = Math.max(0, Math.min(100, (valeur / 5) * 100));
  const mrs = Math.max(0, Math.min(5, Math.round(valeur)));
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
        {brut === null ? (
          <div className="text-sm text-gray-400">{enAttente ? "calcul…" : "modele indisponible"}</div>
        ) : (
          <>
            <div className="text-xl font-bold" style={{ color: mrsColor }}>mRS {mrs}</div>
            <div className="text-xs text-gray-500 leading-tight">{MRS_LABELS[mrs]}</div>
            <div className="text-[10px] text-gray-400 tabular-nums">
              prediction {brut.toFixed(2)}
            </div>
          </>
        )}
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

// Sliders that have a risk curve chart (continuous, non-discrete)
const CHART_SLIDERS = SLIDERS.filter((s) => FACTOR_META[s.key]);

export default function App() {
  // The selected patient is restored from the URL / last session, so a reload
  // stays on the patient that was on screen instead of jumping back to the first.
  const [patientId, setPatientId] = useState<string>(readInitialPatientId);
  const [baseline, setBaseline] = useState<Record<string, number>>(initialValues);
  const [values, setValues] = useState<Record<string, number>>(initialValues);
  const [boolValues, setBoolValues] = useState<Record<string, boolean>>(initialBools);
  const [patientData, setPatientData] = useState<ApiRecord | null>(null);
  const [explication, setExplication] = useState<Explication | null>(null);
  // Explication du patient reel, conservee pour mesurer l'ecart d'une simulation.
  const [reference, setReference] = useState<Explication | null>(null);
  const [calcul, setCalcul] = useState(false);

  // Fetches the patient on mount, on every selection change and on a manual reload.
  useEffect(() => {
    if (!patientId) return;
    rememberPatientId(patientId);

    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(
          `${API_BASE}/patient/${encodeURIComponent(patientId)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

        const payload = await response.json();
        const raw: unknown = payload?.donnees ?? payload?.data ?? payload;
        if (!raw || typeof raw !== "object") throw new Error("Unexpected payload shape");
        if (cancelled) return;

        // Explication du patient tel qu'il est dans le registre.
        const rExp = await fetch(`${API_BASE}/explain/${encodeURIComponent(patientId)}`,
                                 { signal: controller.signal });
        const exp: Explication | null = rExp.ok ? await rExp.json() : null;
        if (cancelled) return;
        setExplication(exp);
        setReference(exp);

        // The payload keys are the registry's, not the UI's — map before use.
        const mapped = mapPatient(raw as ApiRecord);
        setPatientData(raw as ApiRecord);
        setValues(mapped.values);
        setBaseline(mapped.values);
        setBoolValues(mapped.bools);
      } catch (error) {
        if (cancelled || (error as Error)?.name === "AbortError") return;
        // Fall back to the placeholders, but flag it: showing them silently is
        // what made a disconnected UI look like live patient data.
        setPatientData(null);
        setExplication(null);
        setReference(null);
        setValues(initialValues);
        setBaseline(initialValues);
        setBoolValues(initialBools);
        console.error(`API ${API_BASE}/patient/${patientId} :`, error);
      }
    })();

    // A slower answer for a previously selected patient must not overwrite the
    // current one.
    return () => { cancelled = true; controller.abort(); };
  }, [patientId]);

  // Simulation : toute modification de curseur repart au modele. Tant que les
  // valeurs sont celles du patient, le GET initial suffit — inutile de rejouer.
  const identique = SLIDERS.every((s) => values[s.key] === baseline[s.key]);
  useEffect(() => {
    if (!patientId || !patientData || identique) return;

    const controller = new AbortController();
    let annule = false;
    setCalcul(true);

    const minuteur = setTimeout(async () => {
      try {
        const valeurs: Record<string, number> = {};
        for (const cfg of SLIDERS) {
          const colonne = API_COLUMN[cfg.key];
          if (colonne) valeurs[colonne] = versRegistre(cfg.key, values[cfg.key]);
        }
        const r = await fetch(`${API_BASE}/explain/${encodeURIComponent(patientId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ valeurs }),
          signal: controller.signal,
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const exp: Explication = await r.json();
        if (!annule) setExplication(exp);
      } catch (error) {
        if (!annule && (error as Error)?.name !== "AbortError") {
          console.error("simulation :", error);
        }
      } finally {
        if (!annule) setCalcul(false);
      }
    }, 300);   // laisse le curseur se stabiliser avant d'appeler le modele

    return () => { annule = true; controller.abort(); clearTimeout(minuteur); };
  }, [patientId, patientData, identique, values]);

  const variablePour = (key: string) => explication?.variables[API_COLUMN[key] ?? ""];
  const variableBasePour = (key: string) => reference?.variables[API_COLUMN[key] ?? ""];
  const recs = getRecommendations(values, boolValues);

  // Header facts, straight from the payload. `|| "-"` used to hide a legitimate
  // value of 0 (a very common pre-stroke mRS), so test for absence instead.
  const readInfo = (names: string[]) => {
    const v = readField(patientData ?? {}, names);
    if (v === undefined) return "-";
    const n = toNumber(v);
    return n !== undefined ? String(Number(n.toFixed(2))) : String(v);
  };

  const patientInfo: [string, React.ReactNode][] = [
    ["Age", readInfo(["age"])],
    ["Gender", readInfo(["gender"])],
    ["Stroke Type", readInfo(["stroke_type", "strokeType"])],
    ["Pre-stroke mRS", readInfo(["prestroke_mrs", "prestrokeMrs"])],
    ["mRS Discharge", readInfo(["discharge_mrs", "dischargeMrs"])],
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
                <FactorRow key={cfg.key} cfg={cfg} value={values[cfg.key]}
                  variable={variablePour(cfg.key)} />
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
            <RiskGauge mrs={explication?.prediction.mrs ?? null} enAttente={calcul} />
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
                  variable={variablePour(cfg.key)}
                  variableBase={variableBasePour(cfg.key)}
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