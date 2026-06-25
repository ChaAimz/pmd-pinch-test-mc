import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store/app'

// MR3 = Emergency Stop (hardware E-Stop, see backend/config.yaml hardware.plc.device_map).
// Auto-hides only when the bit transitions back to 0 (no user-dismissible UI).
const ESTOP_ADDR = 3

export function EmergencyStopOverlay() {
  const { t } = useTranslation()
  const estop = useAppStore((s) => s.plcBits[ESTOP_ADDR]?.value ?? false)
  if (!estop) return null

  return (
    <div
      // Full-screen overlay; capture all pointer/keyboard events so the operator
      // can't interact with anything else while E-Stop is active.
      role="alert"
      aria-live="assertive"
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-red-950/95 backdrop-blur-sm select-none"
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => e.preventDefault()}
      onClick={(e) => e.preventDefault()}
    >
      {/* Pulsing warning glyph */}
      <div className="text-[12rem] leading-none animate-pulse text-red-500 drop-shadow-[0_0_30px_rgba(239,68,68,0.8)]">
        ⛔
      </div>

      <h1 className="mt-4 text-6xl font-black tracking-wider text-red-100 drop-shadow-lg">
        {t('alarms.estop.title')}
      </h1>

      <p className="mt-4 text-2xl font-semibold text-red-200 tracking-wide">
        {t('alarms.estop.subtitle')}
      </p>

      <p className="mt-8 text-base text-red-300/90 max-w-xl text-center px-6">
        {t('alarms.estop.description')}
      </p>

      {/* Live MR3 indicator */}
      <div className="mt-10 flex items-center gap-3 rounded-lg border-2 border-red-500 bg-red-950/60 px-5 py-3">
        <span className="w-4 h-4 rounded-full bg-red-500 animate-pulse shadow-[0_0_10px_3px_rgba(239,68,68,0.9)]" />
        <span className="font-mono text-sm text-red-100">MR3 = 1 (E-Stop active)</span>
      </div>
    </div>
  )
}
