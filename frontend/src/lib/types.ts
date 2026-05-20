export interface Recipe {
  id: number
  name: string
  actuator_position_mm: number
  speed_mm_s: number
  clamp_threshold_n: number
  loops: number
  hold_time_ms: number
  min_force_n: number | null
  max_force_n: number | null
  created_at: string
  updated_at: string
}
export type RecipeCreate = Omit<Recipe, 'id' | 'created_at' | 'updated_at'>
export type RecipeUpdate = Partial<RecipeCreate>

export interface WsSample { t_ms: number; force_n: number }
export interface WsStateChange { type: 'state_change'; from: string; to: string; run_id?: number; loop?: number }
export interface WsHwStatus { type: 'hw_status'; plc: boolean; imada: boolean; esp32: boolean }
export interface WsLoopResult { type: 'loop_result'; loop: number; result: 'pass' | 'fail'; peak_n: number; hold_ms: number }
export interface WsRunFinished { type: 'run_finished'; run_id: number; passed: number; failed: number }
export interface WsImadaBatch { type: 'imada_batch'; samples: WsSample[] }
export interface WsEsp32Batch { type: 'esp32_batch'; samples: WsSample[] }
export interface WsError { type: 'error'; message: string }
