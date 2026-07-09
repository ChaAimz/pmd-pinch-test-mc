import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, HardDrive, History, Loader2, Monitor, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
// KeyboardInput (not KeyboardSheet) — KeyboardSheet's Done/close both just call
// onOpenChange(false) with no commit-vs-cancel distinction, which is wrong here:
// the outer confirm dialog needs the keyboard to only edit the name, never itself
// trigger the export.
import { KeyboardInput } from '@/components/ui/keyboard-input'
import { api } from '@/lib/api'
import { useSettingsStore } from '@/store/settings'

export interface PendingExport {
  suggested: string   // guided base filename incl. extension
  ext: 'csv' | 'png'
  // Lazily produce the payload at export time (not at "open dialog" time) — e.g. a
  // chart PNG dataURL that may briefly be unavailable. null = not ready yet.
  getContent: () => { content: string; encoding: 'utf8' | 'base64' } | null
}

function stripExt(filename: string, ext: string): string {
  const suffix = `.${ext}`
  return filename.endsWith(suffix) ? filename.slice(0, -suffix.length) : filename
}

function todayFolder(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

export function ExportFilenameDialog({
  pending,
  onOpenChange,
}: {
  pending: PendingExport | null
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [baseName, setBaseName] = useState('')
  const [folderName, setFolderName] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const folderHistory = useSettingsStore((s) => s.exportFolderHistory)
  const addExportFolder = useSettingsStore((s) => s.addExportFolder)
  const clearExportFolderHistory = useSettingsStore((s) => s.clearExportFolderHistory)

  useEffect(() => {
    if (pending) {
      setBaseName(stripExt(pending.suggested, pending.ext))
      setFolderName(todayFolder())
    }
  }, [pending])

  // Informational status line only — never a destination picker. The backend
  // resolves the actual save target itself, fresh, on every export-file call.
  const { data: drivesData } = useQuery({
    queryKey: ['removable-drives'],
    queryFn: api.system.removableDrives,
    refetchInterval: 2500,
    enabled: pending != null,
  })
  const drives = drivesData?.drives ?? []

  async function handleExport() {
    if (!pending || isExporting) return
    const trimmedName = baseName.trim() || stripExt(pending.suggested, pending.ext)
    const trimmedFolder = folderName.trim() || todayFolder()
    const payload = pending.getContent()
    if (!payload) {
      // Chart PNG dataURL wasn't ready yet (e.g. ECharts instance not mounted) — not
      // worth a dedicated i18n key, matches other untranslated toasts in this app.
      toast.error(t('run.exportDialog.saveFailed', { error: 'Content not ready yet — try again in a moment' }))
      return
    }
    setIsExporting(true)
    try {
      const result = await api.system.exportFile({
        folder: trimmedFolder,
        filename: trimmedName,
        ext: pending.ext,
        content: payload.content,
        encoding: payload.encoding,
      })
      toast.success(t('run.exportDialog.saved', { path: result.saved_path }))
      addExportFolder(trimmedFolder)
      onOpenChange(false)
    } catch (e) {
      toast.error(t('run.exportDialog.saveFailed', { error: e instanceof Error ? e.message : String(e) }))
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Dialog open={pending != null} onOpenChange={(o) => { if (!isExporting) onOpenChange(o) }}>
      {/* Anchored near the top (not the default vertical center) — KeyboardInput's
          on-screen keyboard is a fixed bottom sheet covering roughly half the
          viewport, which hides a centered dialog's footer once it opens. Two
          KeyboardInput fields now live here, so the dialog is taller than before —
          top-6 keeps the footer clear of the keyboard sheet for either field. */}
      <DialogContent showCloseButton className="top-6 -translate-y-0 sm:top-10 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('run.exportDialog.title')}</DialogTitle>
        </DialogHeader>

        {/* min-w-0 is load-bearing: DialogContent is a CSS grid (dialog.tsx), and grid
            items default to min-width:auto — i.e. they refuse to shrink below their own
            min-content size. The scrollable chip row below can't cap the shared grid
            track width unless every ancestor up to the grid item also opts out via
            min-w-0, otherwise the whole dialog gets stretched past max-w-sm and its
            background clips while the rows spill out past the visible card edge.

            max-h + overflow-y-auto caps this body's growth so the footer below it can
            never again be pushed down into the keyboard sheet's territory (which covers
            roughly the bottom half of the viewport) — whatever gets added here in the
            future scrolls internally instead of growing the dialog unboundedly.

            p-1.5 (not just py-1) matters once overflow-y is set: per the CSS overflow
            spec, giving one axis a non-visible value forces the other axis's used value
            to auto too, so this box clips on all 4 sides, not just top/bottom. The
            inputs' focus-visible:ring-3 glow (3px) needs clearance on every side or it
            gets flattened off wherever it touches this box's edge. */}
        <div className="flex flex-col gap-1 p-1.5 min-w-0 max-h-[38vh] overflow-y-auto">
          <label htmlFor="export-folder" className="text-xs font-medium text-muted-foreground">
            {t('run.exportDialog.folder')}
          </label>
          <KeyboardInput
            id="export-folder"
            value={folderName}
            onChange={setFolderName}
            title={t('run.exportDialog.folder')}
            className="h-9 text-sm font-mono"
          />
          {folderHistory.length > 0 && (
            // Single scrollable row, not flex-wrap — wrapping to a 2nd line makes the
            // dialog tall enough that its footer (Cancel/Export) ends up hidden behind
            // the on-screen keyboard's bottom sheet. History icon + Clear stay grouped
            // at the row's start (not ml-auto'd to the far edge — that left a big dead
            // gap on wide dialogs); the chip list takes the remaining width via flex-1
            // and scrolls internally if it overflows.
            <div className="flex items-center gap-1.5 mt-1 min-w-0">
              <History size={12} className="text-muted-foreground shrink-0" />
              <button
                type="button"
                onClick={clearExportFolderHistory}
                className="shrink-0 flex items-center gap-0.5 text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                <X size={11} />
                {t('run.exportDialog.clearFolderHistory')}
              </button>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 min-w-0 flex-1">
                {folderHistory.map((folder) => (
                  <button
                    key={folder}
                    type="button"
                    onClick={() => setFolderName(folder)}
                    className="h-6 px-2 rounded-md border border-input bg-background text-xs font-mono text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0 whitespace-nowrap"
                  >
                    {folder}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <KeyboardInput
              id="export-filename"
              value={baseName}
              onChange={setBaseName}
              title={t('run.exportDialog.title')}
              className="flex-1 h-9 text-sm font-mono"
            />
            <span className="text-sm font-mono text-muted-foreground shrink-0">.{pending?.ext}</span>
          </div>

          <div className="flex items-center gap-1.5 text-xs pt-0.5">
            {drives.length > 0 ? (
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <HardDrive size={13} className="shrink-0" />
                {t('run.exportDialog.driveDetected', { label: drives[0].label ?? drives[0].path })}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Monitor size={13} className="shrink-0" />
                {t('run.exportDialog.noDriveDesktop')}
              </span>
            )}
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" disabled={isExporting} />}>
            {t('common.cancel')}
          </DialogClose>
          <Button size="sm" className="gap-1" onClick={handleExport} disabled={isExporting}>
            {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {t('common.export')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
