// UI settings stored in SQLite via /api/settings.
// Keys are camelCase — match the zustand settings store EXACTLY.
// Backend stores them opaquely (JSON blob), so key mismatches are a silent data loss.
export interface UiSettings {
  theme: 'light' | 'dark' | 'system'
  accentHue: number
  sidebarCollapsed: boolean
  esp32Unit: 'gf' | 'N'
  showClampCard: boolean
  chartMode: 'continuous' | 'gated'
  minimalView: boolean
  language: 'en' | 'th' | 'jp'
  clampOffsetGf: number
  chartLineWidth: number
  chartShowSymbol: boolean
  chartSymbolSize: number
  chartSmooth: boolean
  chartShowGrid: boolean
  chartDecimals: number
  chartShowThresholds: boolean
  exportFolderHistory: string[]
}

// Field names mirror backend/app/schemas/recipe.py. Do NOT rename without
// updating both sides — recipe POST is otherwise rejected with 422.
export interface Recipe {
  id: number
  name: string
  description: string | null
  position_mm: number
  speed_mms: number
  clamp_threshold_n: number
  loop_count: number
  min_force_n: number | null
  max_force_n: number | null
  sampling_hz: number
  diameter_mm: number
  prepare_timer_s: number
  created_at: string
  updated_at: string
}
export type RecipeCreate = Omit<Recipe, 'id' | 'created_at' | 'updated_at'>
export type RecipeUpdate = Partial<RecipeCreate>

// Wire format: backend sends each sample as a tuple [t_ms, force_n] to keep the JSON small.
export type WsSample = [t_ms: number, force_n: number]
export interface WsStateChange { type: 'state_change'; from: string; to: string; run_id?: number; loop?: number; at?: string }
export interface WsHwStatus { type: 'hw_status'; plc: boolean; imada: boolean; esp32: boolean }
// Field names mirror backend/app/schemas/ws_messages.py WsLoopResult — keep in sync.
export interface WsLoopResult { type: 'loop_result'; run_id: number; loop: number; peak_force_n: number; min_force_n: number; avg_force_n: number; hold_time_ms: number; tension_end_ms: number | null; peak_clamp_n: number | null; avg_clamp_n: number | null; judgment: 'pass' | 'fail' }
export interface WsRunFinished { type: 'run_finished'; run_id: number; status: string; loops_completed: number }
export interface WsImadaBatch { type: 'imada_batch'; samples: WsSample[] }
export interface WsEsp32Batch { type: 'esp32_batch'; samples: WsSample[] }
export interface WsPlcBit { type: 'plc_bit'; addr: number; value: boolean }
export interface WsError { type: 'error'; message: string }
// Hardware clamp-force limit (force_limit_gf) exceeded — always-on safety alarm.
// Backend has already driven MR804/MR801/MR802 and forced the run to ERROR.
export interface WsClampForceAlarm { type: 'clamp_force_alarm'; message: string; limit_gf: number | null }
// Imada tension warning limit (hardware.imada.tension_limit_n) reached — MR815.
// Informational only: the test keeps running. Operator must ack via REST
// (POST /hardware/imada/tension-alarm/ack) — backend owns clearing the bit.
export interface WsImadaTensionAlarm { type: 'imada_tension_alarm'; active: boolean; message: string | null; limit_n: number | null }

// --- History / Runs ---

export interface TestLoop {
  id: number
  loop_index: number
  started_at: string
  finished_at: string | null
  peak_force_n: number | null
  avg_force_n: number | null
  hold_time_ms: number | null
  tension_end_ms: number | null
  peak_clamp_n: number | null
  avg_clamp_n: number | null
  judgment: 'pass' | 'fail' | null
  waveform_file: string | null
}

export interface TestRun {
  id: number
  recipe_id: number
  operator: string | null
  batch_id: string | null
  shift: string | null
  started_at: string
  finished_at: string | null
  status: 'running' | 'pass' | 'fail' | 'aborted' | 'error'
  abort_reason: string | null
  loops_completed: number
  waveform_dir: string | null
  loops: TestLoop[]
}

// --- Hardware ---

export interface HardwareStatus {
  plc: boolean
  imada: boolean
  esp32: boolean
}

// --- Waveform ---

export interface WaveformPoint {
  t_ms: number
  force_n: number
}

// --- Comparisons ---

export interface Annotation {
  id: string
  cycleIndex: number  // 0-based index (maps to category C1 = index 0)
  yValue: number      // Y axis value at the clicked point (CoF)
  text: string
  color: string       // one of ANNOTATION_COLORS
}

export interface ChartConfig {
  yMin: number | null            // null = auto
  yMax: number | null            // null = auto
  showYGrid: boolean             // horizontal split lines
  yNameGap: number               // gap between Y axis label and its title
  xLabelInterval: number | null  // null = adaptive (auto), 0 = every label, N = every (N+1)th
  lineWidth: number
  symbolSize: number             // size of the round dots on each line
  showSymbol: boolean            // show/hide the round dots
  smooth: boolean                // curved vs straight line
  connectNulls: boolean          // bridge gaps where a cycle has no data
  showValueLabels: boolean       // print the CoF number on each point
  decimals: number               // decimal places in tooltip + value labels
  annotationSymbolSize: number   // arrow marker size
  annotationFontSize: number     // annotation label font size
  showAnnotationLabels: boolean  // show/hide annotation text labels
}

export interface Comparison {
  id: number
  name: string
  description: string | null
  run_ids: number[]
  labels: Record<string, string>   // run-id string -> label
  annotations: Annotation[]
  chart_config: ChartConfig | null
  created_at: string
  updated_at: string
}
export type ComparisonCreate = Omit<Comparison, 'id' | 'created_at' | 'updated_at'>
export type ComparisonUpdate = Partial<ComparisonCreate>

// --- System export (flash-drive / desktop file writer) ---
// Field names mirror backend/app/schemas/system.py — keep in sync.

export interface RemovableDrive {
  path: string
  label: string | null
  free_bytes: number
  total_bytes: number
}

export interface ExportFileRequest {
  folder: string
  filename: string
  ext: 'csv' | 'png'
  content: string
  encoding: 'utf8' | 'base64'
}

export interface ExportFileResponse {
  saved_path: string
  target: 'flash_drive' | 'desktop'
}
