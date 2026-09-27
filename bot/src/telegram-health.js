// Derive readiness from completed Telegram polls, not merely a running process.
export function telegramConnectionStatus(polling, metrics, uptimeSeconds, now=Date.now()) {
  if (!polling?.running) return uptimeSeconds < 90 ? 'starting' : 'degraded';
  const poll=metrics?.polling;
  if (!poll?.last_success_at_ms) return uptimeSeconds < 90 ? 'starting' : 'degraded';
  if (now-poll.last_success_at_ms>90_000 || poll.consecutive_errors>=3) return 'degraded';
  return 'running';
}

export function telegramFailureCode(error,deadlineExceeded=false) {
  if (deadlineExceeded) return 'REQUEST_TIMEOUT';
  let current=error;
  for(let depth=0;depth<5&&current;depth++){
    if(Number.isInteger(current.error_code))return `HTTP_${current.error_code}`;
    if(typeof current.code==='string'&&/^[A-Z0-9_]{1,40}$/.test(current.code))return current.code;
    current=current.error||current.cause;
  }
  return 'NETWORK_ERROR';
}
