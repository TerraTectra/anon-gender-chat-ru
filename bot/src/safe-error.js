const TOKEN_PATTERN = /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g;
const BOT_URL_PATTERN = /https:\/\/api\.telegram\.org\/(?:file\/)?bot[^/\s]+/gi;

export function redactSecrets(value) {
  return String(value ?? "")
    .replace(BOT_URL_PATTERN, "https://api.telegram.org/bot[REDACTED]")
    .replace(TOKEN_PATTERN, "[TELEGRAM_TOKEN_REDACTED]");
}

export function safeErrorSummary(value) {
  const error = value?.error || value;
  const code = error?.error_code ?? error?.code;
  const message = error?.description || error?.message || "unknown error";
  return redactSecrets(code ? `${code}: ${message}` : message);
}

export function isTelegramPollingConflict(value) {
  const queue = [value];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Number(current.error_code) === 409 || Number(current.code) === 409) return true;
    const message = `${current.description || ""} ${current.message || ""}`;
    if (/409|conflict/i.test(message) && /getupdates|terminated by other/i.test(message)) return true;
    for (const key of ["error", "cause", "response"]) queue.push(current[key]);
  }
  return false;
}
