import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store/app'

// Raised when MR811 (Max Stroke of Clamp) goes HIGH — PLC signals the clamp
// has reached its mechanical travel limit, which may indicate a failure or
// damage risk.  Only the operator can dismiss this dialog by clicking Acknowledge;
// the bit going LOW does NOT auto-clear it.
export function MaxStrokeAlarmDialog() {
  const { t } = useTranslation()
  const active = useAppStore((s) => s.maxStrokeAlarm)
  const dismiss = useAppStore((s) => s.setMaxStrokeAlarm)
  if (!active) return null

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-modal="true"
      className="fixed inset-0 z-[9997] flex items-center justify-center bg-black/70 backdrop-blur-sm select-none p-6"
    >
      <div className="w-full max-w-md bg-card border border-orange-500/50 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 bg-orange-500/15 px-6 py-4 border-b border-orange-500/30">
          <span className="flex items-center justify-center w-11 h-11 rounded-lg bg-orange-500/20 text-orange-600 dark:text-orange-400 shrink-0 animate-pulse">
            <AlertTriangle size={24} />
          </span>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-[0.2em] text-orange-600 dark:text-orange-400 font-bold">
              {t('alarms.maxStroke.subtitle')} — MR811
            </span>
            <h2 className="text-lg font-bold text-foreground leading-tight">
              {t('alarms.maxStroke.title')}
            </h2>
          </div>
        </div>

        <div className="px-6 py-5 space-y-3 text-sm text-muted-foreground">
          <p>{t('alarms.maxStroke.body1')}</p>
          <p>{t('alarms.maxStroke.body2')}</p>
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end">
          <button
            type="button"
            autoFocus
            onClick={() => dismiss(false)}
            className="inline-flex items-center justify-center rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold px-5 py-2.5 text-sm transition-colors active:scale-95"
          >
            {t('alarms.acknowledge')}
          </button>
        </div>
      </div>
    </div>
  )
}
