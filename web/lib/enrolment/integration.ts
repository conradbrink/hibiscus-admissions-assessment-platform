import "server-only";
import type { StudentRecordSnapshot } from "@/lib/enrolment/student-record";

/**
 * The seam for the school's student management system (Ed-admin today).
 * Phase 3 ships the "none" implementation: the record is generated, kept,
 * and downloadable; export_status stays pending until an adapter exists.
 * The adapter's contract is this interface and nothing more.
 */
export type ExportResult = { ok: true; externalRef: string } | { ok: false; error: string; retryable: boolean };

export interface StudentManagementSystem {
  readonly name: string;
  exportStudent(record: StudentRecordSnapshot): Promise<ExportResult>;
}

export const noneSystem: StudentManagementSystem = {
  name: "none",
  async exportStudent() {
    return { ok: false, error: "No student management system is configured; the record is ready to download.", retryable: false };
  },
};

export function getStudentSystem(): StudentManagementSystem {
  const which = process.env.STUDENT_SYSTEM ?? "none";
  if (which === "none") return noneSystem;
  throw new Error(`STUDENT_SYSTEM "${which}" is not implemented.`);
}
