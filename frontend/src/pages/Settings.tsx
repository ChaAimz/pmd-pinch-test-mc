import { Sun, Moon, Monitor, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/store/settings'
import type { Language } from '@/store/settings'
import { useChartStore } from '@/store/chart'
import { useAppStore } from '@/store/app'
import { Switch } from '@/components/ui/switch'
import { NumpadInput } from '@/components/ui/numpad-input'

// Mirror useSessionControl's isRunning — the live buffer is only (re)sized at run
// start, so the chart-mode toggle must be locked mid-run to avoid a mis-sized ring.
const RUN_IDLE_STATES = ['IDLE', 'ABORTED', 'ERROR', 'DONE_B7']

const LANGUAGE_OPTIONS: { value: Language; code: string; native: string }[] = [
  { value: 'en', code: 'EN', native: 'English' },
  { value: 'th', code: 'TH', native: 'ภาษาไทย' },
  { value: 'jp', code: 'JP', native: '日本語' },
]

const ACCENT_PRESETS = [
  { hue: 240, label: 'Blue' },
  { hue: 280, label: 'Purple' },
  { hue: 150, label: 'Green' },
  { hue: 30,  label: 'Orange' },
  { hue: 10,  label: 'Red' },
]

// ─── Card wrapper ─────────────────────────────────────────────────────────────
function SettingsCard({ title, description, children }: {
  title: string; description?: string; children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="px-5 pt-4 pb-3 border-b border-border/50">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="p-5 space-y-5">
        {children}
      </div>
    </div>
  )
}

// ─── Row with label + right-side control ─────────────────────────────────────
function SettingsRow({ label, description, children }: {
  label: string; description?: string; children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-1">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Settings() {
  const { t } = useTranslation()
  const {
    theme, setTheme,
    accentHue, setAccentHue,
    esp32Unit, setEsp32Unit,
    showClampCard, setShowClampCard,
    chartMode, setChartMode,
    minimalView, setMinimalView,
    language, setLanguage,
    chartLineWidth, setChartLineWidth,
    chartShowSymbol, setChartShowSymbol,
    chartSymbolSize, setChartSymbolSize,
    chartSmooth, setChartSmooth,
    chartShowGrid, setChartShowGrid,
    chartDecimals, setChartDecimals,
    chartShowThresholds, setChartShowThresholds,
  } = useSettingsStore()

  const machineState = useAppStore((s) => s.machineState)
  const isRunning = !RUN_IDLE_STATES.includes(machineState)

  const THEME_OPTIONS = [
    { value: 'light' as const, Icon: Sun,     label: t('settings.themeLight'),  desc: t('settings.themeDescLight') },
    { value: 'system' as const, Icon: Monitor, label: t('settings.themeSystem'), desc: t('settings.themeDescSystem') },
    { value: 'dark' as const,  Icon: Moon,    label: t('settings.themeDark'),   desc: t('settings.themeDescDark') },
  ]

  return (
    <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 h-full overflow-auto content-start">

      {/* ── Appearance ─────────────────────────────────────────────────── */}
      <SettingsCard title={t('settings.appearance')}>

        {/* Theme */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('settings.theme')}</p>
          <div className="grid grid-cols-3 gap-2">
            {THEME_OPTIONS.map(({ value, Icon, label, desc }) => {
              const active = theme === value
              return (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className={cn(
                    'flex flex-col items-center gap-2 p-3.5 rounded-xl border-2 transition-all',
                    active
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border bg-muted/20 text-muted-foreground hover:border-primary/40 hover:text-foreground',
                  )}
                >
                  <Icon size={20} />
                  <span className="text-xs font-medium">{label}</span>
                  <span className="text-[10px] opacity-60">{desc}</span>
                  {active && <Check size={12} className="text-primary" />}
                </button>
              )
            })}
          </div>
        </div>

        {/* Accent color */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('settings.accent')}</p>
          <div className="flex gap-4">
            {ACCENT_PRESETS.map(({ hue, label }) => {
              const active = accentHue === hue
              return (
                <button
                  key={hue}
                  onClick={() => setAccentHue(hue)}
                  title={label}
                  className={cn(
                    'flex flex-col items-center gap-1.5 transition-all',
                    active ? 'scale-110' : 'hover:scale-105 opacity-60 hover:opacity-100',
                  )}
                >
                  <span
                    className={cn(
                      'w-9 h-9 rounded-full flex items-center justify-center',
                      active && 'ring-2 ring-offset-2 ring-offset-background',
                    )}
                    style={{ backgroundColor: `oklch(0.55 0.22 ${hue})` }}
                  >
                    {active && <Check size={14} className="text-white" />}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{label}</span>
                </button>
              )
            })}
          </div>
        </div>

      </SettingsCard>

      {/* ── Run Page ──────────────────────────────────────────────────────── */}
      <SettingsCard title={t('settings.runPage')}>
        <div className="space-y-1 divide-y divide-border/50">

          <SettingsRow
            label={t('settings.minimalView')}
            description={t('settings.minimalViewDesc')}
          >
            <Switch checked={minimalView} onCheckedChange={setMinimalView} />
          </SettingsRow>

          <div className="pt-4">
            <SettingsRow
              label={t('settings.showClampCard')}
              description={t('settings.showClampCardDesc')}
            >
              <Switch checked={showClampCard} onCheckedChange={setShowClampCard} />
            </SettingsRow>
          </div>

          <div className="pt-4">
            <SettingsRow
              label={t('settings.gatedChart')}
              description={
                isRunning
                  ? t('settings.gatedChartLocked')
                  : chartMode === 'gated'
                    ? t('settings.gatedChartOn')
                    : t('settings.gatedChartOff')
              }
            >
              <Switch
                checked={chartMode === 'gated'}
                disabled={isRunning}
                onCheckedChange={(checked) => {
                  setChartMode(checked ? 'gated' : 'continuous')
                  useChartStore.getState().clear()
                }}
              />
            </SettingsRow>
          </div>

        </div>
      </SettingsCard>

      {/* ── Language ──────────────────────────────────────────────────────── */}
      <SettingsCard title={t('settings.language')} description={t('settings.languageDesc')}>
        <div className="grid grid-cols-3 gap-2">
          {LANGUAGE_OPTIONS.map(({ value, code, native }) => {
            const active = language === value
            return (
              <button
                key={value}
                onClick={() => setLanguage(value)}
                className={cn(
                  'flex flex-col items-center gap-2 p-3.5 rounded-xl border-2 transition-all',
                  active
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border bg-muted/20 text-muted-foreground hover:border-primary/40 hover:text-foreground',
                )}
              >
                <span className="text-lg font-bold font-mono">{code}</span>
                <span className="text-xs">{native}</span>
                {active && <Check size={12} className="text-primary" />}
              </button>
            )
          })}
        </div>
      </SettingsCard>

      {/* ── Sensors ───────────────────────────────────────────────────────── */}
      <SettingsCard title={t('settings.sensors')} description={t('settings.sensorsDesc')}>
        <div className="grid grid-cols-2 gap-2">
          {(['gf', 'N'] as const).map((u) => {
            const active = esp32Unit === u
            return (
              <button
                key={u}
                onClick={() => setEsp32Unit(u)}
                className={cn(
                  'flex flex-col items-center gap-2 p-3.5 rounded-xl border-2 transition-all',
                  active
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border bg-muted/20 text-muted-foreground hover:border-primary/40 hover:text-foreground',
                )}
              >
                <span className="text-lg font-bold font-mono">{u}</span>
                <span className="text-xs">{u === 'gf' ? t('settings.gramForce') : t('settings.newton')}</span>
                {active && <Check size={12} className="text-primary" />}
              </button>
            )
          })}
        </div>
      </SettingsCard>

      {/* ── Chart Display ─────────────────────────────────────────────────── */}
      <SettingsCard title={t('settings.chartDisplay')} description={t('settings.chartDisplayDesc')}>
        <div className="space-y-1 divide-y divide-border/50">

          <SettingsRow label={t('settings.chartLineWidth')}>
            <NumpadInput
              value={String(chartLineWidth)}
              onChange={(v) => setChartLineWidth(Math.max(1, Math.min(6, Number(v))))}
              decimal={false}
              className="h-8 w-20 text-sm"
            />
          </SettingsRow>

          <div className="pt-4">
            <SettingsRow label={t('settings.chartShowSymbol')}>
              <Switch checked={chartShowSymbol} onCheckedChange={setChartShowSymbol} />
            </SettingsRow>
          </div>

          <div className="pt-4">
            <SettingsRow label={t('settings.chartSymbolSize')}>
              <NumpadInput
                value={String(chartSymbolSize)}
                disabled={!chartShowSymbol}
                onChange={(v) => setChartSymbolSize(Math.max(2, Math.min(16, Number(v))))}
                decimal={false}
                className="h-8 w-20 text-sm disabled:opacity-40"
              />
            </SettingsRow>
          </div>

          <div className="pt-4">
            <SettingsRow label={t('settings.chartSmooth')}>
              <Switch checked={chartSmooth} onCheckedChange={setChartSmooth} />
            </SettingsRow>
          </div>

          <div className="pt-4">
            <SettingsRow label={t('settings.chartShowGrid')}>
              <Switch checked={chartShowGrid} onCheckedChange={setChartShowGrid} />
            </SettingsRow>
          </div>

          <div className="pt-4">
            <SettingsRow label={t('settings.chartDecimals')}>
              <NumpadInput
                value={String(chartDecimals)}
                onChange={(v) => setChartDecimals(Math.max(0, Math.min(6, Number(v))))}
                decimal={false}
                className="h-8 w-20 text-sm"
              />
            </SettingsRow>
          </div>

          <div className="pt-4">
            <SettingsRow
              label={t('settings.chartShowThresholds')}
              description={t('settings.chartShowThresholdsDesc')}
            >
              <Switch checked={chartShowThresholds} onCheckedChange={setChartShowThresholds} />
            </SettingsRow>
          </div>

        </div>
      </SettingsCard>

    </div>
  )
}
