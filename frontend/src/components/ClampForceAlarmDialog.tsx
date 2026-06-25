import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store/app'
import { useSettingsStore } from '@/store/settings'

const GF_PER_N = 101.97162129779283

// Raised by the backend `clamp_force_alarm` WS message when the ESP32 clamp-force
// reading exceeds the HARDWARE limit (force_limit_gf) — an always-on safety event.
// By the time this shows, the backend has set MR810 (Clamp Force Limit) and forced
// any running test to ERROR. The PLC ladder handles stop/reset from MR810.
// The operator acknowledges here, then clears the machine with Reset on the Run page.
export function ClampForceAlarmDialog() {
  const { t } = useTranslation()
  const message = useAppStore((s) => s.clampForceAlarm)
  const limitGf = useAppStore((s) => s.clampForceAlarmLimit)
  const dismiss = useAppStore((s) => s.setClampForceAlarm)
  const esp32Unit = useSettingsStore((s) => s.esp32Unit)
  if (!message) return null

  const limitDisplay = limitGf != null
    ? esp32Unit === 'N'
      ? `${(limitGf / GF_PER_N).toFixed(4)} N`
      : `${limitGf.toFixed(0)} gf`
    : null

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-modal="true"
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 backdrop-blur-sm select-none p-6"
    >
      <div className="w-full max-w-md bg-card border border-amber-500/50 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 bg-amber-500/15 px-6 py-4 border-b border-amber-500/30">
          <span className="flex items-center justify-center w-11 h-11 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0 animate-pulse">
            <AlertTriangle size={24} />
          </span>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-[0.2em] text-amber-600 dark:text-amber-400 font-bold">
              {t('alarms.clampForce.subtitle')} — MR810
            </span>
            <h2 className="text-lg font-bold text-foreground leading-tight">{message}</h2>
          </div>
        </div>

        <div className="px-6 py-5 space-y-3 text-sm text-muted-foreground">
          <p>{t('alarms.clampForce.body1')}</p>
          {limitDisplay && (
            <div className="flex items-center gap-3 rounded-lg bg-amber-500/10 border border-amber-500/30 px-4 py-2.5">
              <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold uppercase tracking-wider">
                {t('alarms.clampForce.forceLimitLabel')}
              </span>
              <span className="font-mono font-bold text-foreground text-sm">{limitDisplay}</span>
              {esp32Unit === 'N' && limitGf != null && (
                <span className="text-xs text-muted-foreground/70 font-mono ml-auto">{limitGf.toFixed(0)} gf raw</span>
              )}
            </div>
          )}
          <p>{t('alarms.clampForce.body2')}</p>
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end">
          <button
            type="button"
            autoFocus
            onClick={() => dismiss(null)}
            className="inline-flex items-center justify-center rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold px-5 py-2.5 text-sm transition-colors active:scale-95"
          >
            {t('alarms.acknowledge')}
          </button>
        </div>
      </div>
    </div>
  )
}
