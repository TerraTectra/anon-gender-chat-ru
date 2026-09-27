import { telegramFailureCode } from './telegram-health.js';
// Bound slow requests without retrying potentially delivered messages.
export function installTelegramReliability(bot, { onForbidden = () => {}, timeoutMs = 12000 } = {}) {
  const samples = [];
  const stats = { calls: 0, errors: 0, harmless: 0 };
  const polling = { successes:0, errors:0, consecutive_errors:0, last_success_at_ms:null, last_error_at_ms:null, last_error_code:null };
  let lastPollWarningAt=0;
  function pollFailure(error,deadlineExceeded){
    polling.errors++;
    polling.consecutive_errors++;
    polling.last_error_at_ms=Date.now();
    polling.last_error_code=telegramFailureCode(error,deadlineExceeded);
    if(Date.now()-lastPollWarningAt>=60_000){
      console.warn('Telegram polling unavailable', JSON.stringify({at:new Date().toISOString(),code:polling.last_error_code,consecutive:polling.consecutive_errors}));
      lastPollWarningAt=Date.now();
    }
  }
  bot.api.config.use(async (previous, method, payload, signal) => {
    const started = performance.now();
    stats.calls++;
    const limit = method === 'getUpdates' ? Math.max(10_000, Math.min(60, Number(payload.timeout)||30)*1000+10_000)
      : method === 'answerPreCheckoutQuery' ? 3000
      : method === 'answerCallbackQuery' ? 2000
      : ['sendPhoto','sendVideo','sendDocument','sendAudio','sendAnimation'].includes(method) ? 60000 : timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Telegram request deadline exceeded')), limit);
    timer.unref?.();
    // grammY may supply its abort-controller polyfill. Native AbortSignal.any
    // rejects that otherwise compatible signal, so bridge the abort event instead.
    const forwardAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener('abort', forwardAbort, { once: true });
    const abortSignal = controller.signal;
    try {
      const response = await previous(method, payload, abortSignal);
      if (method === 'getUpdates') {
        if(response.ok){
          polling.successes++;
          polling.last_success_at_ms=Date.now();
          polling.consecutive_errors=0;
        }else pollFailure(response,false);
      }
      if (!response.ok) {
        const description = response.description || '';
        if ((method === 'answerCallbackQuery' && response.error_code === 400 && /query is too old|query ID is invalid/i.test(description)) ||
            (method.startsWith('editMessage') && response.error_code === 400 && /message is not modified/i.test(description))) {
          stats.harmless++;
          return { ok: true, result: true };
        }
        if (method === 'editMessageText' && response.error_code === 400 && payload.chat_id &&
            /message can't be edited|message to edit not found/i.test(description)) {
          stats.harmless++;
          const {chat_id,text,entities,parse_mode,reply_markup,link_preview_options} = payload;
          return await previous('sendMessage', {chat_id,text,entities,parse_mode,reply_markup,link_preview_options}, abortSignal);
        }
        if (response.error_code === 403 && /bot was blocked by the user/i.test(description) && Number.isSafeInteger(Number(payload.chat_id))) {
          onForbidden(Number(payload.chat_id));
        }
        stats.errors++;
      }
      return response;
    } catch (error) {
      if (!signal?.aborted) {
        stats.errors++;
        if(method==='getUpdates')pollFailure(error,controller.signal.aborted);
      }
      // Callback acknowledgements are ephemeral. Failure must not cancel the user's action.
      if (method === 'answerCallbackQuery') { stats.harmless++; return { ok: true, result: true }; }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
      if (method !== 'getUpdates') {
        samples.push(Math.round(performance.now() - started));
        if (samples.length > 256) samples.shift();
      }
    }
  });
  bot.telegramMetrics = () => {
    const sorted = [...samples].sort((a,b) => a-b);
    return { ...stats, polling:{...polling}, samples: sorted.length, p95_ms: sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1] : null };
  };
}

export function createSingleFlightRetry(task, { now = Date.now, minimumMs = 60000, maximumMs = 900000 } = {}) {
  let running = false, retryAt = 0, failures = 0;
  return async () => {
    if (running || now() < retryAt) return false;
    running = true;
    try { await task(); failures = 0; retryAt = 0; return true; }
    catch (error) { failures++; retryAt = now() + Math.min(maximumMs, minimumMs * 2 ** Math.min(failures - 1, 10)); throw error; }
    finally { running = false; }
  };
}
