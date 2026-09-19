"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { NativeSelect } from "@/components/ui/native-select";

/**
 * "All campuses" or one of them, at the top of every CRM page. Changes the
 * `campus` query parameter and keeps the rest, so a filter set on the
 * families list survives choosing a campus. The list offered is the
 * caller's accessible campuses, so a restricted person is never offered a
 * choice the policies would answer with an empty page.
 */
export function CampusPicker({ campuses, current, className }: { campuses: Array<{ id: string; name: string }>; current: string | null; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // One campus is not a choice; the page is that campus's already.
  if (campuses.length <= 1) return null;
  return (
    <NativeSelect
      aria-label="Campus"
      value={current ?? ""}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        if (e.target.value) next.set("campus", e.target.value);
        else next.delete("campus");
        next.delete("page");
        router.push(`${pathname}${next.toString() ? `?${next}` : ""}`);
      }}
      className={className ?? "w-48"}
    >
      <option value="">All campuses</option>
      {campuses.map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </NativeSelect>
  );
}
