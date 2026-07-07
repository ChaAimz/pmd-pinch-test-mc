import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, HardDrive, Loader2, Monitor } from 'lucide-react'
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
      <DialogContent showCloseButton className="top-6 -translate-y-0 sm:top-10">
        <DialogHeader>
          <DialogTitle>{t('run.exportDialog.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-1 py-1">
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
        </div>

        <div className="flex items-center gap-2 py-1">
          <KeyboardInput
            id="export-filename"
            value={baseName}
            onChange={setBaseName}
            title={t('run.exportDialog.title')}
            className="flex-1 h-9 text-sm font-mono"
          />
          <span className="text-sm font-mono text-muted-foreground shrink-0">.{pending?.ext}</span>
        </div>

        <div className="flex items-center gap-1.5 text-xs -mt-1">
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
