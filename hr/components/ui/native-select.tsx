"use client"

import * as React from "react"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * A styled native `<select>`.
 *
 * Used everywhere a parent picks from a list, on purpose: the native control
 * opens the phone's own picker, which is the fastest, most accessible thing
 * on a small screen. A custom dropdown looks nicer on a laptop and is worse
 * on every phone.
 *
 * It holds its own value when given `defaultValue`, and that is not a detail.
 * React 19 resets an uncontrolled form once its action returns. A text input
 * survives because `defaultValue` is the `value` *attribute* and a reset
 * restores attributes — a `<select>` has no equivalent, so the browser snaps
 * it back to its first option. Every dropdown on a page therefore emptied
 * itself whenever any one field failed validation.
 *
 * What that did to a parent filling in the registration form: they missed one
 * dropdown, got the error, chose the missing answer, pressed Save — and found
 * the ones they had already answered now blank and newly invalid. Correcting
 * one mistake produced several more, every time, which reads as a form that
 * will not accept anything.
 *
 * So `defaultValue` here means "start here, and stay put": the value is held
 * in state and React writes it back on the render after the reset. When
 * `defaultValue` itself changes — the server echoing a submission back,
 * tidying a value, or clearing it — the field adopts the new one, so a form
 * that means to reset after a successful save still does. Passing `value`
 * instead gives an ordinary controlled select and none of this applies.
 */
function NativeSelect({ value, defaultValue, ...props }: React.ComponentProps<"select">) {
  // A select somebody else controls is theirs; one with neither value nor
  // default has nothing to hold. Both go straight through.
  return value === undefined && defaultValue !== undefined ? (
    <StickySelect defaultValue={defaultValue} {...props} />
  ) : (
    <Shell value={value} defaultValue={defaultValue} {...props} />
  )
}

/**
 * The held-value half, split out because hooks cannot be called conditionally.
 */
function StickySelect({ defaultValue, onChange, ...props }: React.ComponentProps<"select">) {
  const asked = String(defaultValue ?? "")
  const [chosen, setChosen] = React.useState(asked)
  // The last value the *caller* asked for. Comparing against this rather than
  // against `chosen` is what lets the parent's own later choice stand while
  // still adopting a genuinely new default. Adjusting state during render is
  // the documented pattern for this; an effect would paint the stale value
  // first and flicker.
  const [lastAsked, setLastAsked] = React.useState(asked)
  if (asked !== lastAsked) {
    setLastAsked(asked)
    setChosen(asked)
  }
  return (
    <Shell
      {...props}
      value={chosen}
      onChange={(e) => {
        setChosen(e.target.value)
        onChange?.(e)
      }}
    />
  )
}

function Shell({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div data-slot="native-select-wrapper" className="relative">
      <select
        data-slot="native-select"
        className={cn(
          "h-11 w-full appearance-none rounded-xl border border-input bg-card py-2 pr-9 pl-3 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:h-9 md:text-sm",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}

export { NativeSelect }
