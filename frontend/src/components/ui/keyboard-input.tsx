/**
 * KeyboardInput — text input with an on-screen keyboard bottom sheet.
 * Clicking or focusing the input opens the keyboard automatically.
 * Every key press updates the value in real-time via onChange.
 *
 * Supports 3 language layouts:
 *   EN — QWERTY lower/upper + 123 symbol rows (original behaviour)
 *   TH — Thai Kedmanee base + shifted layer; Shift key shown
 *   JP — Katakana Gojuuon direct-tap grid + dakuten/handakuten buttons
 *
 * Language resets to EN each time the keyboard opens fresh.
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Delete, ChevronUp, Check } from 'lucide-react'
import ReactCountryFlag from 'react-country-flag'

// ---------------------------------------------------------------------------
// Language type
// ---------------------------------------------------------------------------

type Lang = 'en' | 'th' | 'jp'

// ---------------------------------------------------------------------------
// Shared close-on-outside-click helper
// ---------------------------------------------------------------------------

function useCloseOnOutsidePointer(
  open: boolean,
  popupRef: React.RefObject<HTMLDivElement | null>,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return
    function handler(e: PointerEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        close()
      }
    }
    document.addEventListener('pointerdown', handler, { capture: true })
    return () => document.removeEventListener('pointerdown', handler, { capture: true })
  }, [open, popupRef, close])
}

// ---------------------------------------------------------------------------
// EN — QWERTY layout
// ---------------------------------------------------------------------------

const QWERTY_LOWER = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
]
const QWERTY_UPPER = QWERTY_LOWER.map((row) => row.map((k) => k.toUpperCase()))
const SYMBOL_ROW1 = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
const SYMBOL_ROW2 = ['-', '_', '.', '@', '#', '&', '/', '(', ')']
const SYMBOL_ROW3 = ['!', '?', ',', ';', ':', "'", '"', '+', '=']

// ---------------------------------------------------------------------------
// TH — Thai Kedmanee layout
// ---------------------------------------------------------------------------

// Base layer (QWERTY positions q..p, a..l, z..m)
const TH_BASE = [
  ['ๆ', 'ไ', 'ำ', 'พ', 'ะ', 'ั', 'น', 'ย', 'บ', 'ล'],
  ['ฟ', 'ห', 'ก', 'ด', 'เ', '้', '่', 'า', 'ส', 'ว'],
  ['ผ', 'ป', 'แ', 'อ', 'ิ', 'ื', 'ท', 'ม', 'ใ'],
]

// Shifted layer — less-common characters
const TH_SHIFT = [
  ['๐', 'ฤ', 'ฎ', 'ฑ', 'ธ', 'ํ', '๊', 'ณ', 'ฯ', 'ญ'],
  ['ฃ', 'ฅ', 'ฆ', 'ฏ', 'โ', '็', 'ั', 'า', 'ษ', 'ศ'],
  ['ฦ', 'ข', 'ซ', 'ว', 'ำ', 'ฺ', 'ฒ', 'ฬ', 'ฝ'],
]

// Extra common chars shown in the bottom row beside Space
const TH_EXTRA = ['ง', 'ฃ']

// ---------------------------------------------------------------------------
// JP — Romaji → Katakana conversion
// ---------------------------------------------------------------------------

// Romaji table: longest matches first to ensure greedy matching
const ROMAJI_KATA: Record<string, string> = {
  // 3-char combos
  sha: 'シャ', shi: 'シ', shu: 'シュ', she: 'シェ', sho: 'ショ',
  chi: 'チ', cha: 'チャ', chu: 'チュ', che: 'チェ', cho: 'チョ',
  tsu: 'ツ',
  kya: 'キャ', kyu: 'キュ', kyo: 'キョ',
  nya: 'ニャ', nyu: 'ニュ', nyo: 'ニョ',
  hya: 'ヒャ', hyu: 'ヒュ', hyo: 'ヒョ',
  mya: 'ミャ', myu: 'ミュ', myo: 'ミョ',
  rya: 'リャ', ryu: 'リュ', ryo: 'リョ',
  gya: 'ギャ', gyu: 'ギュ', gyo: 'ギョ',
  bya: 'ビャ', byu: 'ビュ', byo: 'ビョ',
  pya: 'ピャ', pyu: 'ピュ', pyo: 'ピョ',
  // 2-char combos
  ka: 'カ', ki: 'キ', ku: 'ク', ke: 'ケ', ko: 'コ',
  sa: 'サ', si: 'シ', su: 'ス', se: 'セ', so: 'ソ',
  ta: 'タ', ti: 'チ', tu: 'ツ', te: 'テ', to: 'ト',
  na: 'ナ', ni: 'ニ', nu: 'ヌ', ne: 'ネ', no: 'ノ',
  ha: 'ハ', hi: 'ヒ', hu: 'フ', he: 'ヘ', ho: 'ホ',
  fu: 'フ',
  ma: 'マ', mi: 'ミ', mu: 'ム', me: 'メ', mo: 'モ',
  ya: 'ヤ', yu: 'ユ', yo: 'ヨ',
  ra: 'ラ', ri: 'リ', ru: 'ル', re: 'レ', ro: 'ロ',
  wa: 'ワ', wi: 'ウィ', we: 'ウェ', wo: 'ヲ',
  ga: 'ガ', gi: 'ギ', gu: 'グ', ge: 'ゲ', go: 'ゴ',
  za: 'ザ', zi: 'ジ', zu: 'ズ', ze: 'ゼ', zo: 'ゾ',
  da: 'ダ', di: 'ヂ', du: 'ヅ', de: 'デ', do: 'ド',
  ba: 'バ', bi: 'ビ', bu: 'ブ', be: 'ベ', bo: 'ボ',
  pa: 'パ', pi: 'ピ', pu: 'プ', pe: 'ペ', po: 'ポ',
  nn: 'ン',
  // Single vowels
  a: 'ア', i: 'イ', u: 'ウ', e: 'エ', o: 'オ',
}

// All valid romaji prefixes (for buffering decisions)
const ROMAJI_PREFIXES = new Set<string>()
Object.keys(ROMAJI_KATA).forEach((k) => {
  for (let i = 1; i <= k.length; i++) ROMAJI_PREFIXES.add(k.slice(0, i))
})

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u'])

/**
 * Attempt to convert a romaji buffer.
 * Returns { output, remaining } where output is the katakana produced
 * and remaining is any unconsumed romaji to re-buffer.
 */
function convertRomaji(buf: string): { output: string; remaining: string } {
  // Exact match
  if (ROMAJI_KATA[buf]) return { output: ROMAJI_KATA[buf], remaining: '' }
  // Still a valid prefix — keep buffering
  if (ROMAJI_PREFIXES.has(buf)) return { output: '', remaining: buf }
  // Not a prefix anymore — try longest prefix match from front
  for (let len = buf.length - 1; len >= 1; len--) {
    const prefix = buf.slice(0, len)
    if (ROMAJI_KATA[prefix]) {
      return { output: ROMAJI_KATA[prefix], remaining: buf.slice(len) }
    }
  }
  // No match at all — flush first char as-is
  return { output: buf[0] ?? '', remaining: buf.slice(1) }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface KeyboardInputProps {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  className?: string
  id?: string
  title?: string
  disabled?: boolean
}

// ---------------------------------------------------------------------------
// Inner keyboard body — shared between KeyboardInput and KeyboardSheet
// ---------------------------------------------------------------------------

interface KeyboardBodyProps {
  value: string
  press: (char: string) => void
  backspace: () => void
  clear: () => void
  space: () => void
  commit: () => void
  lang: Lang
  setLang: (l: Lang) => void
  shifted: boolean
  setShifted: (fn: (s: boolean) => boolean) => void
  symbolMode: boolean
  setSymbolMode: (fn: (s: boolean) => boolean) => void
}

function KeyboardBody({
  value,
  press,
  backspace,
  clear,
  space,
  commit,
  lang,
  setLang,
  shifted,
  setShifted,
  symbolMode,
  setSymbolMode,
}: KeyboardBodyProps) {
  const enLetterRows = shifted ? QWERTY_UPPER : QWERTY_LOWER
  const enSymRows = [SYMBOL_ROW1, SYMBOL_ROW2, SYMBOL_ROW3]
  const enRows = symbolMode ? enSymRows : enLetterRows
  const thRows = shifted ? TH_SHIFT : TH_BASE

  // JP: romaji buffer + katakana/hiragana toggle
  const [romajiBuffer, setRomajiBuffer] = useState('')
  const [hiragana, setHiragana] = useState(false)

  useEffect(() => { setRomajiBuffer(''); setHiragana(false) }, [lang])

  function toHira(str: string) {
    return str.replace(/[ァ-ン]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
  }

  function pushKata(kata: string) {
    press(hiragana ? toHira(kata) : kata)
  }

  function flushBuffer(buf: string) {
    let remaining = buf
    let iters = 0
    while (remaining.length > 0 && iters++ < 10) {
      const { output, remaining: next } = convertRomaji(remaining)
      if (output) { pushKata(output); remaining = next }
      else break
    }
    setRomajiBuffer(remaining)
  }

  function pressJP(char: string) {
    const c = char.toLowerCase()
    const newBuf = romajiBuffer + c
    // Double consonant → ッ (e.g. tt → ッ + t)
    if (newBuf.length >= 2 && newBuf[0] === newBuf[1] && !VOWELS.has(newBuf[0]) && newBuf[0] !== 'n') {
      pushKata('ッ'); flushBuffer(newBuf.slice(1)); return
    }
    // n + consonant (not 'n' or vowel) → ン
    if (romajiBuffer === 'n' && !VOWELS.has(c) && c !== 'n') {
      pushKata('ン'); flushBuffer(c); return
    }
    flushBuffer(newBuf)
  }

  function jpBackspace() {
    if (romajiBuffer.length > 0) setRomajiBuffer((p) => p.slice(0, -1))
    else backspace()
  }

  const BottomRow = ({ children }: { children?: React.ReactNode }) => (
    <div className="flex items-center gap-1.5 mt-1.5 w-full">
      {children}
      <button type="button" onClick={space} className="flex-[5] h-14 rounded-md border border-input bg-background text-sm text-muted-foreground hover:bg-accent active:scale-95 transition-transform">Space</button>
      <KeyBtn label="Clear" flex="flex-[1.5]" className="text-xs text-destructive border-destructive/40 hover:bg-destructive/10" onPress={clear} />
      <Button type="button" className="flex-[2] h-14 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white" onClick={commit}>Done</Button>
    </div>
  )

  return (
    <>
      {/* Language + JP sub-toggle row */}
      <div className="flex gap-1 mb-2 items-center">
        {(['en', 'th', 'jp'] as Lang[]).map((l) => (
          <button key={l} type="button" onClick={() => setLang(l)}
            className={cn('h-8 px-3 text-xs rounded-md border transition-colors',
              l === lang ? 'bg-secondary text-secondary-foreground border-secondary font-semibold'
                : 'border-input bg-background text-muted-foreground hover:bg-accent')}
          >
            <ReactCountryFlag
              countryCode={l === 'en' ? 'US' : l === 'th' ? 'TH' : 'JP'}
              svg
              style={{ width: '1.4em', height: '1.4em', borderRadius: '2px' }}
            />
          </button>
        ))}
        {lang === 'jp' && (
          <div className="flex gap-1 ml-auto">
            {([false, true] as const).map((h) => (
              <button key={String(h)} type="button" onClick={() => setHiragana(h)}
                className={cn('h-8 px-2 text-xs rounded-md border transition-colors',
                  hiragana === h ? 'bg-secondary text-secondary-foreground border-secondary font-semibold'
                    : 'border-input bg-background text-muted-foreground hover:bg-accent')}
              >{h ? 'ひら' : 'カナ'}</button>
            ))}
          </div>
        )}
      </div>

      {/* Pending romaji indicator */}
      {lang === 'jp' && romajiBuffer && (
        <div className="mb-1.5 text-center text-sm font-mono bg-muted/60 rounded px-2 py-0.5 text-muted-foreground">
          <span className="underline decoration-dotted">{romajiBuffer}</span>
          <span className="opacity-60 ml-1.5">→ {convertRomaji(romajiBuffer).output || '…'}</span>
        </div>
      )}

      {/* EN layout */}
      {lang === 'en' && (
        <>
          <div className="flex flex-col gap-1.5 w-full">
            {enRows.map((row, ri) => (
              <div key={ri} className="flex w-full gap-1">
                {!symbolMode && ri === 2 && <KeyBtn label={<ChevronUp size={18} />} flex="flex-[1.5]" active={shifted} onPress={() => setShifted((s) => !s)} />}
                {row.map((key) => <KeyBtn key={key} label={key} flex="flex-1" onPress={() => press(key)} />)}
                {ri === 0 && <KeyBtn label={<Delete size={18} />} flex="flex-[1.5]" onPress={backspace} />}
                {ri === 1 && <KeyBtn label={<Check size={18} />} flex="flex-[1.5]" onPress={commit} className="bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-600" />}
                {!symbolMode && ri === 2 && <KeyBtn label={<ChevronUp size={18} />} flex="flex-[1.5]" active={shifted} onPress={() => setShifted((s) => !s)} />}
              </div>
            ))}
          </div>
          <BottomRow><KeyBtn label={symbolMode ? 'ABC' : '123'} flex="flex-[1.5]" className="text-xs" onPress={() => setSymbolMode((s) => !s)} /></BottomRow>
        </>
      )}

      {/* TH layout */}
      {lang === 'th' && (
        <>
          <div className="flex flex-col gap-1.5 w-full">
            {thRows.map((row, ri) => (
              <div key={ri} className="flex w-full gap-1">
                {ri === 2 && <KeyBtn label={<ChevronUp size={18} />} flex="flex-[1.5]" active={shifted} onPress={() => setShifted((s) => !s)} />}
                {row.map((key) => <KeyBtn key={key} label={key} flex="flex-1" onPress={() => press(key)} />)}
                {ri === 0 && <KeyBtn label={<Delete size={18} />} flex="flex-[1.5]" onPress={backspace} />}
                {ri === 1 && <KeyBtn label={<Check size={18} />} flex="flex-[1.5]" onPress={commit} className="bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-600" />}
                {ri === 2 && <KeyBtn label={<ChevronUp size={18} />} flex="flex-[1.5]" active={shifted} onPress={() => setShifted((s) => !s)} />}
              </div>
            ))}
          </div>
          <BottomRow>{TH_EXTRA.map((ch) => <KeyBtn key={ch} label={ch} flex="flex-[1]" onPress={() => press(ch)} />)}</BottomRow>
        </>
      )}

      {/* JP layout — QWERTY romaji → katakana / hiragana */}
      {lang === 'jp' && (
        <>
          <div className="flex flex-col gap-1.5 w-full">
            {QWERTY_LOWER.map((row, ri) => (
              <div key={ri} className="flex w-full gap-1">
                {row.map((key) => <KeyBtn key={key} label={key} flex="flex-1" onPress={() => pressJP(key)} />)}
                {ri === 0 && <KeyBtn label={<Delete size={18} />} flex="flex-[1.5]" onPress={jpBackspace} />}
                {ri === 1 && <KeyBtn label={<Check size={18} />} flex="flex-[1.5]" onPress={commit} className="bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-600" />}
              </div>
            ))}
          </div>
          <BottomRow>
            <KeyBtn label={hiragana ? 'ん' : 'ン'} flex="flex-[1]" onPress={() => { setRomajiBuffer(''); pushKata('ン') }} />
            <KeyBtn label="ー" flex="flex-[1]" onPress={() => { setRomajiBuffer(''); press('ー') }} />
          </BottomRow>
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// KeyboardInput
// ---------------------------------------------------------------------------

export function KeyboardInput({
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  id,
  title,
  disabled,
}: KeyboardInputProps) {
  const [open, setOpen] = useState(false)
  const [lang, setLang] = useState<Lang>('en')
  const [shifted, setShifted] = useState(false)
  const [symbolMode, setSymbolMode] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  // Prevent immediate re-open when focus returns to input after keyboard closes
  const justClosedRef = useRef(false)

  const closeKeyboard = useCallback(() => {
    setOpen(false)
    onBlur?.()
    justClosedRef.current = true
    setTimeout(() => { justClosedRef.current = false }, 300)
  }, [onBlur])

  useCloseOnOutsidePointer(open, popupRef, closeKeyboard)

  function openKeyboard() {
    if (disabled || justClosedRef.current) return
    setLang('en')
    setShifted(false)
    setSymbolMode(false)
    setOpen(true)
  }

  function handleOpenChange(next: boolean) {
    if (!next) closeKeyboard()
    else setOpen(true)
  }

  const press = useCallback((char: string) => {
    const next = (value ?? '') + char
    onChange(next)
    // Auto-cancel shift after a letter key in EN mode; for TH/JP the caller
    // handles this by passing setShifted, but shifted is reset per lang anyway.
    if (shifted) setShifted(false)
  }, [value, onChange, shifted])

  const backspace = useCallback(() => {
    onChange((value ?? '').slice(0, -1))
  }, [value, onChange])

  const clear = useCallback(() => onChange(''), [onChange])
  const space = useCallback(() => onChange((value ?? '') + ' '), [value, onChange])

  const commit = useCallback(() => {
    setOpen(false)
    onBlur?.()
    justClosedRef.current = true
    setTimeout(() => { justClosedRef.current = false }, 300)
  }, [onBlur])

  return (
    <>
      {/* Visible input — clicking/focusing opens the keyboard */}
      <Input
        ref={inputRef}
        id={id}
        value={value ?? ''}
        placeholder={placeholder}
        className={cn('cursor-pointer', className)}
        disabled={disabled}
        readOnly
        onFocus={openKeyboard}
        onClick={openKeyboard}
        onBlur={onBlur}
      />

      {/* Bottom-sheet keyboard */}
      <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
        <DialogPrimitive.Portal>
          {/* Backdrop is visual-only — pointer-events-none so clicks pass through */}
          <DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-black/20 pointer-events-none duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />

          <DialogPrimitive.Popup
            className={cn(
              'fixed bottom-0 left-0 right-0 z-50',
              'bg-card border-t border-border rounded-t-xl',
              'p-4 pb-6 select-none',
              'duration-200',
              'data-open:animate-in data-open:slide-in-from-bottom-4',
              'data-closed:animate-out data-closed:slide-out-to-bottom-4',
            )}
          >
            {/* Inner wrapper used by useCloseOnOutsidePointer */}
            <div ref={popupRef}>
              {/* Header: title + live preview */}
              <div className="flex items-center justify-between mb-3">
                <DialogPrimitive.Title className="text-sm font-semibold text-muted-foreground shrink-0">
                  {title ?? 'Keyboard'}
                </DialogPrimitive.Title>
                <div className="flex-1 mx-4 font-mono text-base bg-muted rounded-md px-3 py-1.5 min-h-[2.25rem] truncate text-right text-foreground">
                  {value || <span className="text-muted-foreground text-sm">{placeholder}</span>}
                </div>
                <DialogPrimitive.Close
                  render={
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors text-lg leading-none shrink-0"
                    />
                  }
                  aria-label="Close keyboard"
                >
                  ✕
                </DialogPrimitive.Close>
              </div>

              <KeyboardBody
                value={value}
                press={press}
                backspace={backspace}
                clear={clear}
                space={space}
                commit={commit}
                lang={lang}
                setLang={setLang}
                shifted={shifted}
                setShifted={setShifted}
                symbolMode={symbolMode}
                setSymbolMode={setSymbolMode}
              />
            </div>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  )
}

// ---------------------------------------------------------------------------
// Key button helper
// ---------------------------------------------------------------------------

interface KeyBtnProps {
  label: React.ReactNode
  flex: string
  onPress: () => void
  className?: string
  active?: boolean
}

function KeyBtn({ label, flex, onPress, className, active }: KeyBtnProps) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={cn(
        flex,
        'h-14 px-1 rounded-md border border-input bg-background',
        'text-sm font-medium',
        'hover:bg-accent active:scale-95 transition-transform',
        'flex items-center justify-center',
        active && 'bg-secondary text-secondary-foreground border-secondary',
        className,
      )}
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// KeyboardSheet — standalone bottom-sheet for non-<Input> targets (e.g. cmdk)
// ---------------------------------------------------------------------------

export interface KeyboardSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  onChange: (value: string) => void
  title?: string
  placeholder?: string
}

export function KeyboardSheet({
  open,
  onOpenChange,
  value,
  onChange,
  title,
  placeholder,
}: KeyboardSheetProps) {
  const [lang, setLang] = useState<Lang>('en')
  const [shifted, setShifted] = useState(false)
  const [symbolMode, setSymbolMode] = useState(false)
  const popupRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setLang('en')
      setShifted(false)
      setSymbolMode(false)
    }
  }, [open])

  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  useCloseOnOutsidePointer(open, popupRef, close)

  const press = useCallback((char: string) => {
    onChange((value ?? '') + char)
    if (shifted) setShifted(false)
  }, [value, onChange, shifted])

  const backspace = useCallback(() => onChange((value ?? '').slice(0, -1)), [value, onChange])
  const clear = useCallback(() => onChange(''), [onChange])
  const space = useCallback(() => onChange((value ?? '') + ' '), [value, onChange])
  const commit = useCallback(() => onOpenChange(false), [onOpenChange])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Backdrop visual-only — pointer-events-none so clicks reach underlying elements */}
        <DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-black/20 pointer-events-none duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup
          className={cn(
            'fixed bottom-0 left-0 right-0 z-50',
            'bg-card border-t border-border rounded-t-xl',
            'p-4 pb-6 select-none',
            'duration-200',
            'data-open:animate-in data-open:slide-in-from-bottom-4',
            'data-closed:animate-out data-closed:slide-out-to-bottom-4',
          )}
        >
          <div ref={popupRef}>
            <div className="flex items-center justify-between mb-3">
              <DialogPrimitive.Title className="text-sm font-semibold text-muted-foreground shrink-0">
                {title ?? 'Keyboard'}
              </DialogPrimitive.Title>
              <div className="flex-1 mx-4 font-mono text-base bg-muted rounded-md px-3 py-1.5 min-h-[2.25rem] truncate text-right text-foreground">
                {value || <span className="text-muted-foreground text-sm">{placeholder}</span>}
              </div>
              <DialogPrimitive.Close
                render={
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors text-lg leading-none shrink-0"
                  />
                }
                aria-label="Close keyboard"
              >
                ✕
              </DialogPrimitive.Close>
            </div>

            <KeyboardBody
              value={value}
              press={press}
              backspace={backspace}
              clear={clear}
              space={space}
              commit={commit}
              lang={lang}
              setLang={setLang}
              shifted={shifted}
              setShifted={setShifted}
              symbolMode={symbolMode}
              setSymbolMode={setSymbolMode}
            />
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
