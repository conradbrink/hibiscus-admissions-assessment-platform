import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, MessageRow } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

/**
 * The WhatsApp inbox: every conversation, newest first, with what was last
 * said and how many replies nobody has opened.
 *
 * A conversation is a contact. The rows are read through the caller's
 * client, so a campus manager's inbox is their families' replies; the
 * grouping is done here because PostgREST does not group.
 */
export type Conversation = {
  contactId: string;
  contact: { id: string; first_name: string; last_name: string; mobile: string | null; family_id: string | null; whatsapp_opt_in: boolean } | null;
  family: { id: string; display_name: string | null; family_code: string } | null;
  last: MessageRow;
  unread: number;
  total: number;
};

export async function listConversations(supabase: Client, opts: { q?: string; unreadOnly?: boolean; limit?: number } = {}): Promise<Conversation[]> {
  const { data: messages, error } = await supabase
    .from("messages")
    .select("*")
    .not("contact_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);

  const byContact = new Map<string, { last: MessageRow; unread: number; total: number }>();
  for (const m of messages ?? []) {
    const id = m.contact_id!;
    const c = byContact.get(id);
    const unread = m.direction === "in" && !m.crm_read_at ? 1 : 0;
    if (!c) byContact.set(id, { last: m, unread, total: 1 });
    else {
      c.unread += unread;
      c.total += 1;
    }
  }
  const ids = [...byContact.keys()];
  if (!ids.length) return [];

  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, mobile, family_id, whatsapp_opt_in, families!contacts_family_id_fkey(id, display_name, family_code)")
    .in("id", ids.slice(0, 500));
  const contactOf = new Map((contacts ?? []).map((c) => [c.id, c]));

  let out: Conversation[] = ids.map((contactId) => {
    const c = contactOf.get(contactId) ?? null;
    const fam = c ? (Array.isArray(c.families) ? (c.families[0] ?? null) : c.families) : null;
    const g = byContact.get(contactId)!;
    return {
      contactId,
      contact: c ? { id: c.id, first_name: c.first_name, last_name: c.last_name, mobile: c.mobile, family_id: c.family_id, whatsapp_opt_in: c.whatsapp_opt_in } : null,
      family: fam,
      last: g.last,
      unread: g.unread,
      total: g.total,
    };
  });
  if (opts.unreadOnly) out = out.filter((c) => c.unread > 0);
  if (opts.q?.trim()) {
    const q = opts.q.trim().toLowerCase();
    out = out.filter((c) => {
      const name = c.contact ? `${c.contact.first_name} ${c.contact.last_name}`.toLowerCase() : "";
      const fam = c.family ? `${c.family.display_name ?? ""} ${c.family.family_code}`.toLowerCase() : "";
      return name.includes(q) || fam.includes(q) || (c.contact?.mobile ?? "").includes(q) || c.last.rendered_text.toLowerCase().includes(q);
    });
  }
  return out.slice(0, opts.limit ?? 200);
}

export async function loadConversation(supabase: Client, contactId: string) {
  const [{ data: contact }, { data: messages }] = await Promise.all([
    supabase
      .from("contacts")
      .select("*, families!contacts_family_id_fkey(id, display_name, family_code, campus_id)")
      .eq("id", contactId)
      .maybeSingle(),
    supabase.from("messages").select("*").eq("contact_id", contactId).order("created_at"),
  ]);
  if (!contact) return null;
  const ids = (messages ?? []).map((m) => m.id);
  const { data: events } = ids.length ? await supabase.from("message_events").select("*").in("message_id", ids).order("id") : { data: [] };
  return { contact, messages: messages ?? [], events: events ?? [] };
}
