"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Check, Package, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type PickerOption = {
  id: string;
  label: string;
  /** A second, quieter line: the department, the quantity on the shelf. */
  detail?: string;
  /** Words that find it besides its label: an employee number, a category. */
  keywords?: string;
  disabled?: boolean;
  /** Why it cannot be chosen, shown in place of the detail. */
  disabledReason?: string;
  /** A photo beside the label, for items: the right one at a glance. */
  image?: string | null;
};

/**
 * A searchable list for a phone: type two letters, tap the row. Built rather
 * than borrowed because a native <select> of two hundred names cannot be
 * searched, and a popover that opens under the keyboard is a list nobody can
 * see. The list here sits in the page, every row is a 48px target, and the
 * choice, once made, becomes a single line with a way to change it.
 */
export function Picker({
  options,
  value,
  onChange,
  placeholder,
  label,
  emptyText = "Nothing matches.",
  footer,
  autoFocus,
  invalid,
  name,
}: {
  options: PickerOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder: string;
  /** The accessible name. */
  label: string;
  emptyText?: string;
  /** Under the list: "Add a new employee", "Create a new item". */
  footer?: React.ReactNode;
  autoFocus?: boolean;
  invalid?: boolean;
  /** A hidden field carrying the choice, for a plain form submit. */
  name?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.id === value) ?? null;

  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const found = words.length
      ? options.filter((o) => {
          const hay = `${o.label} ${o.detail ?? ""} ${o.keywords ?? ""}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        })
      : options;
    // Fifty rows is more than a phone shows; the search narrows the rest.
    return found.slice(0, 50);
  }, [options, query]);

  const choose = (o: PickerOption) => {
    if (o.disabled) return;
    onChange(o.id);
    setQuery("");
    setOpen(false);
  };

  if (selected) {
    return (
      <div className="flex min-h-12 items-center gap-3 rounded-xl border border-primary/40 bg-accent/60 px-3 py-2">
        {name ? <input type="hidden" name={name} value={selected.id} /> : null}
        {selected.image !== undefined ? <Thumb src={selected.image} /> : <Check className="size-5 shrink-0 text-primary" aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium text-foreground md:text-sm">{selected.label}</p>
          {selected.detail ? <p className="truncate text-xs text-muted-foreground">{selected.detail}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className="inline-flex h-10 shrink-0 items-center gap-1 rounded-lg px-3 text-sm font-medium text-primary hover:bg-card focus-visible:outline-2 focus-visible:outline-ring"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {name ? <input type="hidden" name={name} value="" /> : null}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground md:size-4" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={invalid || undefined}
          aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].id}` : undefined}
          autoFocus={autoFocus}
          autoComplete="off"
          enterKeyHint="search"
          placeholder={placeholder}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              if (open && matches[active]) {
                e.preventDefault();
                choose(matches[active]);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className={cn(
            "h-12 w-full rounded-xl border border-input bg-card pr-10 pl-10 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 md:h-10 md:text-sm",
            invalid && "border-destructive ring-3 ring-destructive/20"
          )}
        />
        {query ? (
          <button type="button" aria-label="Clear the search" onClick={() => setQuery("")} className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
          <ul id={listId} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto overscroll-contain">
            {matches.length === 0 ? (
              <li className="px-4 py-3 text-sm text-muted-foreground">{emptyText}</li>
            ) : (
              matches.map((o, i) => (
                <li
                  key={o.id}
                  id={`${listId}-${o.id}`}
                  role="option"
                  aria-selected={i === active}
                  aria-disabled={o.disabled || undefined}
                  onMouseEnter={() => setActive(i)}
                  // Pointer down rather than click, so the choice lands before
                  // the input's blur on a phone.
                  onPointerDown={(e) => {
                    e.preventDefault();
                    choose(o);
                  }}
                  className={cn(
                    "flex min-h-12 cursor-pointer items-center gap-3 border-t border-border/60 px-4 py-2 first:border-t-0",
                    i === active && !o.disabled && "bg-muted",
                    o.disabled && "cursor-not-allowed opacity-55"
                  )}
                >
                  {o.image !== undefined ? <Thumb src={o.image} /> : null}
                  <span className="flex min-w-0 flex-col">
                    <span className="text-base text-foreground md:text-sm">{o.label}</span>
                    {o.disabled && o.disabledReason ? (
                      <span className="text-xs text-destructive">{o.disabledReason}</span>
                    ) : o.detail ? (
                      <span className="text-xs text-muted-foreground">{o.detail}</span>
                    ) : null}
                  </span>
                </li>
              ))
            )}
          </ul>
          {footer ? <div className="border-t border-border bg-muted/40">{footer}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/** An option's photo, or the package glyph when it has none. */
function Thumb({ src }: { src: string | null }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-muted">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private, session-checked route; the optimiser would fetch it without the session
        <img src={src} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <Package className="size-5 text-muted-foreground" aria-hidden />
      )}
    </span>
  );
}
