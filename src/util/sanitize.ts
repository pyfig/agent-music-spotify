/**
 * Strips paste artifacts that silently turn a valid credential into a
 * rejected one: surrounding whitespace, wrapping quotes (copied from JSON),
 * and an accidental "Bearer " prefix (copied from a curl example). Used at
 * both the config save choke point and inside providers — keys can also
 * arrive via a hand-edited config.json or a raw env var, so providers
 * sanitize again defensively. Single source of truth for the rule.
 */
export function sanitizeCredential(value: string): string {
  let v = value.trim();
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    v = v.slice(1, -1).trim();
  }
  return v.replace(/^bearer\s+/i, "");
}
