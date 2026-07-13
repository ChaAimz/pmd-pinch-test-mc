/**
 * NumpadInput — numeric input with an on-screen keypad popover.
 *
 * Designed for kiosk / shop-floor use where a physical keyboard may not be
 * available.  Works as a controlled component:
 *
 *   <NumpadInput value={field.value} onChange={field.onChange} decimal />
 *
 * Props
 * -----
 * value    — current string value (react-hook-form Controller passes field.value)
 * onChange — called with the new string when a key is pressed or OK is tapped
 * onBlur   — forwarded to the underlying input (for react-hook-form dirty tracking)
 * decimal  — show the '.' key (default true); set false for integer-only fields
 * id, className, placeholder, disabled — forwarded to the underlying Input
 */
import { useState, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Delete } from 'lucide-react'

interface NumpadInputProps {
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  decimal?: boolean
  negative?: boolean
  id?: string
  className?: string
  placeholder?: string
  disabled?: boolean
}

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3']

export function NumpadInput({
  value,
  onChange,
  onBlur,
  decimal = true,
  negative = false,
  id,
  className,
  placeholder,
  disabled,
}: NumpadInputProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  const suppressOpenRef = useRef(false)

  // Keep draft in sync with external value when popover is closed
  useEffect(() => {
    if (!open) setDraft(value ?? '')
  }, [value, open])

  function press(key: string) {
    setDraft((prev) => {
      if (key === 'C') return ''
      if (key === '⌫') return prev.slice(0, -1)
      if (key === '±') {
        if (prev === '' || prev === '0') return prev
        return prev.startsWith('-') ? prev.slice(1) : '-' + prev
      }
      if (key === '.') {
        if (!decimal || prev.includes('.')) return prev
        return prev === '' ? '0.' : prev + '.'
      }
      // Prevent leading zeros except "0."
      const digits = prev.startsWith('-') ? prev.slice(1) : prev
      if (digits === '0' && key !== '.') return (prev.startsWith('-') ? '-' : '') + key
      return prev + key
    })
  }

  // Defensive guard against Input's onFocus (below) re-opening the popover right
  // after we've just closed it (Popover.Trigger returns focus to itself on close).
  function suppressReopenBriefly() {
    suppressOpenRef.current = true
    // Clear flag after focus restoration has settled
    setTimeout(() => { suppressOpenRef.current = false }, 300)
  }

  function commit() {
    suppressReopenBriefly()
    onChange(draft)
    setOpen(false)
    onBlur?.()
  }

  function handleOpenChange(next: boolean, eventDetails: { reason?: string; cancel?: () => void }) {
    // Root cause of the "popover won't stay open/closed reliably" bug: Popover.Trigger's
    // click handling special-cases "typeable" reference elements (inputs) — mousedown
    // opens the popover, then the click that follows (same physical tap, no actual
    // second press) is evaluated against the now-already-open state and, because a
    // repeat press on an open trigger normally means "toggle it closed", base-ui closes
    // it right back a few ms after it opened. Confirmed via stack trace: the close comes
    // through with reason 'trigger-press', not 'outside-press'. A tap on this field
    // should always open and STAY open — only an outside tap, Esc, or OK should close it
    // — so veto this specific self-inflicted close via Base UI's cancel() hook rather
    // than fighting it with more state (that's what let the original bug "sometimes"
    // reproduce: two different bugs — this one, and the focus-restore reopen handled by
    // suppressReopenBriefly below — happened to mask each other on plenty of taps).
    if (!next && eventDetails.reason === 'trigger-press') {
      eventDetails.cancel?.()
      return
    }
    if (next) {
      // Initialise draft from the current external value on open
      setDraft(value ?? '')
    } else {
      // Commit on dismiss (click-outside / Esc). Arm the reopen guard — Popover.Trigger
      // returns focus to the Input when it closes, which re-fires onFocus below and
      // would otherwise reopen the popover right back up after every legitimate close.
      suppressReopenBriefly()
      onChange(draft)
      onBlur?.()
    }
    setOpen(next)
  }

  return (
    <Popover open={open && !disabled} onOpenChange={handleOpenChange}>
      {/* render={<Input .../>} merges Popover.Trigger's props directly onto the Input —
          a single DOM node, not Input nested inside a separate wrapper <button> (avoids
          an invalid <button><input></button> DOM tree and its own hydration warnings).
          The real fix for the self-close bug lives in handleOpenChange above (vetoing
          'trigger-press' closes) — this element still needs to BE the registered
          Popover.Trigger reference (not just visually anchored) so base-ui's own
          outside-press dismiss logic correctly recognises taps on this Input as "on the
          trigger", not "outside". No onClick of our own here — Trigger's built-in click
          handling opens it; onFocus below covers tab-navigation accessibility, which is
          why the reopen-suppression guard above still matters (Trigger returns focus to
          itself whenever the popover closes, re-firing onFocus). */}
      <PopoverTrigger
        disabled={disabled}
        nativeButton={false}
        render={
          <Input
            ref={inputRef}
            id={id}
            value={open ? draft : (value ?? '')}
            placeholder={placeholder}
            className={className}
            // Base UI's useButton only sets aria-disabled for non-native-button
            // triggers (nativeButton={false}, required since we're rendering an
            // <input>) — the actual HTML `disabled` attribute must still be set here
            // directly, or the Tailwind `disabled:*` styling on callers (e.g. Settings'
            // symbol-size field, disabled:opacity-40) silently stops applying.
            disabled={disabled}
            readOnly
            onFocus={() => { if (!disabled && !suppressOpenRef.current) setOpen(true) }}
            onKeyDown={(e) => e.preventDefault()}
            tabIndex={disabled ? -1 : 0}
          />
        }
      />

      <PopoverContent
        className="w-52 p-3 select-none"
        align="start"
      >
        {/* Value display */}
        <div className="font-mono text-right text-xl border rounded-md px-3 py-1.5 mb-3 bg-muted min-h-[2.5rem] overflow-hidden">
          {draft === '' ? <span className="text-muted-foreground">0</span> : draft}
        </div>

        {/* 3 × 3 digit grid */}
        <div className="grid grid-cols-3 gap-1.5 mb-1.5">
          {KEYS.map((k) => (
            <NumKey key={k} label={k} onPress={() => press(k)} />
          ))}
        </div>

        {/* Bottom row: [±] [.] [0] [⌫]  — ± only when negative=true */}
        <div className={`grid gap-1.5 mb-3 ${negative && decimal ? 'grid-cols-4' : 'grid-cols-3'}`}>
          {negative && <NumKey label="±" onPress={() => press('±')} />}
          {decimal ? (
            <NumKey label="." onPress={() => press('.')} />
          ) : (
            !negative && <div /> // placeholder to keep 0 centred when neither
          )}
          <NumKey label="0" onPress={() => press('0')} />
          <button
            type="button"
            onClick={() => press('⌫')}
            className="flex items-center justify-center h-11 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent active:scale-95 transition-transform"
          >
            <Delete size={16} />
          </button>
        </div>

        {/* C + OK row */}
        <div className="flex gap-1.5">
          <Button
            type="button"
            variant="outline"
            className="flex-1 h-10 text-sm"
            onClick={() => press('C')}
          >
            C
          </Button>
          <Button
            type="button"
            className="flex-1 h-10 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white"
            onClick={commit}
          >
            OK
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ---------- helper ----------
function NumKey({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="h-11 rounded-md border border-input bg-background text-base font-semibold hover:bg-accent active:scale-95 transition-transform"
    >
      {label}
    </button>
  )
}
