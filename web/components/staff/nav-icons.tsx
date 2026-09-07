"use client";

import {
  BarChart3, Blocks, BookOpen, Building2, CalendarDays, CalendarOff, CheckSquare, ClipboardCheck, Columns3, CreditCard,
  Download, FileSignature, FileText, FolderCheck, GraduationCap, Inbox, LayoutDashboard, ListChecks, Mail, MessageCircle,
  PenLine, Scale, ScrollText, Send, Settings, ShieldCheck, Sliders, Target, TrendingUp, Trash2, Users, UserCog, type LucideIcon,
} from "lucide-react";
import type { NavIcon } from "@/components/staff/nav-items";

/** The one place a nav icon name becomes a glyph. */
export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  applicants: Users,
  assessment: ClipboardCheck,
  tasks: CheckSquare,
  decisions: Scale,
  offers: FileText,
  payments: CreditCard,
  registrations: FolderCheck,
  export: Download,
  analytics: BarChart3,
  forecast: TrendingUp,
  settings: Settings,
  questions: BookOpen,
  templates: Blocks,
  rubrics: PenLine,
  benchmarks: Target,
  competencies: ListChecks,
  rules: ShieldCheck,
  sessions: CalendarDays,
  holidays: CalendarOff,
  email: Mail,
  whatsapp: MessageCircle,
  offerTemplates: ScrollText,
  agreements: FileSignature,
  documents: FolderCheck,
  fees: CreditCard,
  campuses: Building2,
  grades: GraduationCap,
  intakes: CalendarDays,
  staff: UserCog,
  workflow: Sliders,
  retention: Trash2,
  columns: Columns3,
  outbox: Send,
  jobs: Inbox,
};
