/**
 * Language ids this extension activates for.
 *
 * No language is contributed here. Magic Racket owns the `racket` id, its
 * grammar and its language configuration; adding our own would conflict with it.
 * A user whose files are not already recognised should map them with
 * `files.associations`.
 */
export const SUPPORTED_LANGUAGES = ["racket", "scheme", "lisp", "commonlisp"] as const;

export function isSupported(languageId: string): boolean {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(languageId);
}
