import { Info, RefreshCw } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store/app'
import { api } from '@/lib/api'

// Raised by the backend `imada_tension_alarm` WS message when the live Imada force
// gauge reading reaches the configured warning limit (hardware.imada.tension_limit_n,
// default 2 N) during a tension check — MR815 (Web→PLC, backend-owned).
//
// Unlike ClampForceAlarmDialog (MR810, a hardware SAFETY alarm that aborts the run to
// ERROR), this is INFORMATIONAL ONLY — the test keeps running. There is no auto-clear:
// the operator must acknowledge, and because MR815 is backend-owned, dismissing calls
// POST /hardware/imada/tension-alarm/ack so the backend actually clears the PLC bit
// (mirrors CompleteLoopsDialog's MR814 ack pattern — NOT a pure local-state dismiss).
export function ImadaTensionAlarmDialog() {
  const { t } = useTranslation()
  const message = useAppStore((s) => s.imadaTensionAlarm)
  const limitN = useAppStore((s) => s.imadaTensionAlarmLimit)
  const setImadaTensionAlarm = useAppStore((s) => s.setImadaTensionAlarm)

  const ackM = useMutation({
    mutationFn: () => api.hardware.ackImadaTensionAlarm(),
    onSuccess: () => {
      // Optimistically close; the imada_tension_alarm echo (active: false) will also clear it.
      setImadaTensionAlarm(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!message) return null

  return (
    <div
      role="alertdialog"
      aria-live="polite"
      aria-modal="true"
      className="fixed inset-0 z-[9996] flex items-center justify-center bg-black/70 backdrop-blur-sm select-none p-6"
    >
      <div className="w-full max-w-md bg-card border border-sky-500/50 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 bg-sky-500/15 px-6 py-4 border-b border-sky-500/30">
          <span className="flex items-center justify-center w-11 h-11 rounded-lg bg-sky-500/20 text-sky-600 dark:text-sky-400 shrink-0">
            <Info size={24} />
          </span>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-[0.2em] text-sky-600 dark:text-sky-400 font-bold">
              {t('alarms.imadaTension.subtitle')} — MR815
            </span>
            <h2 className="text-lg font-bold text-foreground leading-tight">{message}</h2>
          </div>
        </div>

        <div className="px-6 py-5 space-y-3 text-sm text-muted-foreground">
          <p>{t('alarms.imadaTension.body1')}</p>
          {limitN != null && (
            <div className="flex items-center gap-3 rounded-lg bg-sky-500/10 border border-sky-500/30 px-4 py-2.5">
              <span className="text-xs text-sky-600 dark:text-sky-400 font-semibold uppercase tracking-wider">
                {t('alarms.imadaTension.limitLabel')}
              </span>
              <span className="font-mono font-bold text-foreground text-sm">{limitN.toFixed(2)} N</span>
            </div>
          )}
          <p>{t('alarms.imadaTension.body2')}</p>
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end">
          <button
            type="button"
            autoFocus
            disabled={ackM.isPending}
            onClick={() => ackM.mutate()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white font-semibold px-5 py-2.5 text-sm transition-colors active:scale-95"
          >
            {ackM.isPending && <RefreshCw size={15} className="animate-spin" />}
            {t('alarms.acknowledge')}
          </button>
        </div>
      </div>
    </div>
  )
}
