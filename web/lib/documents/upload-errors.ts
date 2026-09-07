/** What a parent reads when an upload is refused. Client-safe: no server imports. */
export const UPLOAD_ERRORS: Record<string, string> = {
  too_large: "That file is larger than 10 MB. A photo from a phone or a PDF is usually well under that.",
  bad_type: "We can accept a PDF, a JPEG or a PNG. That file was something else.",
  empty: "That file was empty. Please choose it again.",
  unknown_requirement: "We did not recognise which document that was for. Please try again.",
  not_open: "Documents can only be changed while registration is open.",
  busy: "Too many uploads in a short time. Please wait a minute and try again.",
  expired: "Your link has expired. Ask for a fresh one from the email and try again.",
  failed: "The upload did not go through. Please try again.",
};

export function uploadErrorText(code: string | null | undefined): string {
  return (code && UPLOAD_ERRORS[code]) || UPLOAD_ERRORS.failed;
}
