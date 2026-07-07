import { CheckCircle2, RefreshCw } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store/app'
import { api } from '@/lib/api'

// Raised when MR814 (Loops Complete ack) goes HIGH — the PLC has signalled that all
// loops of the run are finished and is waiting for the operator to acknowledge.
// Confirm writes MR814 LOW (Web→PLC) so the PLC ladder can proceed; the dialog then
// dismisses when the bit reads back LOW (and optimistically on a successful write).
export function CompleteLoopsDialog() {
  const { t } = useTranslation()
  const active = useAppStore((s) => s.loopsCompleteAck)
  const setLoopsCompleteAck = useAppStore((s) => s.setLoopsCompleteAck)
  const loopsCompleted = useAppStore((s) => s.loopResults.length)

  const confirmM = useMutation({
    // Write MR814 = false to acknowledge completion back to the PLC.
    mutationFn: () => api.hardware.setBit(814, false),
    onSuccess: () => {
      // Optimistically close; the plc_bit echo for MR814→LOW will also clear it.
      setLoopsCompleteAck(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!active) return null

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-modal="true"
      className="fixed inset-0 z-[9997] flex items-center justify-center bg-black/70 backdrop-blur-sm select-none p-6"
    >
      <div className="w-full max-w-md bg-card border border-emerald-500/50 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 bg-emerald-500/15 px-6 py-4 border-b border-emerald-500/30">
          <span className="flex items-center justify-center w-11 h-11 rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 shrink-0">
            <CheckCircle2 size={24} />
          </span>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-400 font-bold">
              {t('alarms.completeLoops.subtitle')} — MR814
            </span>
            <h2 className="text-lg font-bold text-foreground leading-tight">
              {t('alarms.completeLoops.title')}
            </h2>
          </div>
        </div>

        <div className="px-6 py-5 space-y-3 text-sm text-muted-foreground">
          <p>{t('alarms.completeLoops.body1')}</p>
          {loopsCompleted > 0 && (
            <div className="flex items-center gap-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5">
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold uppercase tracking-wider">
                {t('alarms.completeLoops.loopsLabel')}
              </span>
              <span className="font-mono font-bold text-foreground text-sm">{loopsCompleted}</span>
            </div>
          )}
          <p>{t('alarms.completeLoops.body2')}</p>
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end">
          <button
            type="button"
            autoFocus
            disabled={confirmM.isPending}
            onClick={() => confirmM.mutate()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white font-semibold px-5 py-2.5 text-sm transition-colors active:scale-95"
          >
            {confirmM.isPending && <RefreshCw size={15} className="animate-spin" />}
            {t('alarms.completeLoops.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
