"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Field, invalidProps } from "@/components/parent/register/field";
import { Input } from "@/components/ui/input";
import { COUNTRIES } from "@/lib/countries";

export type ListFieldProps = {
  name: string;
  label: string;
  /** In the order to show before the parent types: the likeliest answers first. */
  options: readonly string[];
  initial: string;
  error?: string;
  fields: Record<string, string>;
  required?: boolean;
  readOnly: boolean;
  prefilled?: boolean;
  hint?: string;
};

/**
 * A pick-from-a-list text box: it filters the options as the parent types,
 * with the likeliest answers at the top before any typing. The chosen text
 * is submitted in the same field, so the server validates it against the
 * list (strictly for countries, leniently for languages and medical aids)
 * and nothing downstream changes shape. Built by hand rather than with a
 * datalist because a datalist's suggestions are near-invisible on iPhones,
 * which is what most parents use.
 */
export function ListField({ name, label, options, initial, error, fields, required, readOnly, prefilled, hint }: ListFieldProps) {
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const listId = useId();
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const matches = useMemo(() => {
    const q = fold(value.trim());
    const hits = q ? options.filter((o) => fold(o).includes(q)) : options;
    // Names that start with the typed text come before names that only contain it.
    return [...hits].sort((a, b) => Number(fold(b).startsWith(q)) - Number(fold(a).startsWith(q))).slice(0, 8);
  }, [value, options]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const choose = (o: string) => {
    setValue(o);
    setOpen(false);
  };

  return (
    <Field id={name} label={label} error={error} hint={hint ?? (readOnly ? undefined : "Start typing, then choose from the list.")} prefilled={prefilled}>
      <div ref={wrap} className="relative">
        <Input
          id={name}
          name={name}
          value={value}
          required={required}
          readOnly={readOnly}
          autoComplete="off"
          autoCapitalize="words"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          onChange={(e) => {
            setValue(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => !readOnly && setOpen(true)}
          onKeyDown={(e) => {
            if (!open || matches.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(matches[active] ?? matches[0]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          {...invalidProps(fields, name)}
        />
        {open && !readOnly && matches.length ? (
          <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-border bg-card py-1 shadow-lg">
            {matches.map((o, i) => (
              <li
                key={o}
                role="option"
                aria-selected={i === active}
                className={`cursor-pointer px-3 py-2 text-base md:text-sm ${i === active ? "bg-primary/10" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {o}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Field>
  );
}

/** A country or nationality, the school's own countries first; the server accepts only the list. */
export function CountryField({ kind, ...props }: Omit<ListFieldProps, "options"> & { kind: "country" | "nationality" }) {
  const options = useMemo(() => COUNTRIES.map((c) => (kind === "country" ? c.name : c.nationality)), [kind]);
  return <ListField {...props} options={options} />;
}
