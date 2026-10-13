"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { NativeSelect } from "@/components/ui/native-select";

/**
 * A select that is one query parameter: choosing an option reloads the page
 * with `name` set to it and every other parameter kept, so a filter applies
 * the moment it changes rather than waiting for an Apply button. An empty
 * value removes the parameter. The scroll position stays put, because these
 * sit beside what they change, not at the top of the page.
 */
export function ParamSelect({
  name,
  label,
  value,
  options,
  className,
}: {
  name: string;
  /** The accessible name; the select usually sits beside a visible one. */
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <NativeSelect
      aria-label={label}
      defaultValue={value}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        if (e.target.value) next.set(name, e.target.value);
        else next.delete(name);
        router.push(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
      }}
      className={className}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </NativeSelect>
  );
}
