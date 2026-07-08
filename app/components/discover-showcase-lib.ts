// Pure helpers for the landing "For Food Lovers" discovery showcase.
// No React/DOM — unit-testable with tsx.

/** Build the dynamic "Now serving …" line from the states present in live cards. */
export function serviceAreaLine(states: (string | null | undefined)[]): string {
  const uniq = [...new Set(states.map((s) => (s ?? "").trim()).filter(Boolean))];
  if (uniq.length === 0) return "Now serving cities across Nigeria";
  if (uniq.length <= 2) return `Now serving ${uniq.join(" & ")}`;
  return `Now serving ${uniq.slice(0, 2).join(", ")} & more`;
}
