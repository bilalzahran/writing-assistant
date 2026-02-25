const MAX_PRECEDING_TEXT = 500;

export function truncatePrecedingText(text: string): string {
  if (text.length <= MAX_PRECEDING_TEXT) return text;
  return text.slice(text.length - MAX_PRECEDING_TEXT);
}

export function extractLastPartialWord(text: string): string {
  const trimmed = text.trimEnd();
  const lastSpaceIdx = trimmed.lastIndexOf(" ");
  return lastSpaceIdx === -1 ? trimmed : trimmed.slice(lastSpaceIdx + 1);
}

export function postProcessSuggestion(raw: string): string {
  return raw.trim().replace(/[.,!?]+$/, "");
}
