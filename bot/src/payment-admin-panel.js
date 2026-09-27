import { InlineKeyboard } from 'grammy';
import { TestPaymentStore } from './test-payment.js';
import { premiumDate } from './premium-bot.js';
import { safeErrorSummary } from './safe-error.js';

export const PAYMENTS_LABEL = '💳 Платежи';
const UUID = '[0-9a-f-]{36}';
export function formatStarBalance(value) {
  if (!Number.isSafeInteger(value?.amount) || !Number.isInteger(value.nanostar_amount ?? 0) || Math.abs(value.nanostar_amount ?? 0) >= 1e9) throw new Error('invalid_star_balance');
  const amount = value.amount + (value.nanostar_amount ?? 0) / 1e9;
  return amount.toLocaleString('ru-RU', {maximumFractionDigits: 9});
}
export function findAdminPayment(premium, tests, kind, id) {
  if (kind === 'p') {
    const row = premium.paymentForOrder(id);
    return row ? {...row, kind, id: row.order_id, title: `Премиум на ${row.days} дней`} : null;
  }
  if (kind === 't') {
    const row = tests.order(id);
    return row?.paid_ms != null && row.charge_id ? {...row, kind, order_id: row.id, days: 0, title: 'Тестовая оплата'} : null;
  }
  return null;
}
export function recentAdminPayments(premium, limit = 10) {
  return premium.db.prepare(`
    SELECT 'p' AS kind, order_id AS id, stars, days, paid_ms, refunded_ms FROM premium_payments
    UNION ALL
    SELECT 't' AS kind, id, stars, 0 AS days, paid_ms, refunded_ms FROM test_payment_orders
    WHERE paid_ms IS NOT NULL AND charge_id IS NOT NULL
    ORDER BY paid_ms DESC LIMIT ?
  `).all(limit);
}
export async function adminPaymentsView(premium, balanceProvider) {
  let balanceText;
  try {
    if (!balanceProvider) throw new Error('balance_not_connected');
    balanceText = `Баланс основного бота: ${formatStarBalance(await balanceProvider())} ⭐\nПроверено в Telegram. Это баланс принимающего оплату бота, не ваш личный баланс и не баланс админ-бота.`;
  } catch {
    balanceText = 'Баланс Telegram сейчас не удалось получить. Он НЕ считается нулевым. Список ниже — сохранённые платежи; нажмите «Обновить баланс».';
  }
  const payments = recentAdminPayments(premium);
  const active = premium.db.prepare('SELECT COUNT(*) n FROM premium_access WHERE until_ms>?').get(Date.now()).n;
  const tests = premium.db.prepare('SELECT COUNT(*) n FROM test_payment_orders WHERE paid_ms IS NOT NULL').get().n;
  const review = premium.db.prepare('SELECT COUNT(*) n FROM payment_anomalies').get().n;
  const keyboard = new InlineKeyboard();
  for (const p of payments) {
    const name = p.kind === 't' ? 'Тестовая оплата' : `Премиум ${p.days} дн.`;
    keyboard.text(`${p.refunded_ms != null ? 'Возвращён · ' : ''}${name} · ${p.stars} ⭐`, `payment:${p.kind}:${p.id}`).row();
  }
  keyboard.text('Обновить баланс', 'payments:home').text('Обращения', 'payments:support').row().text('Сверить с Telegram', 'payments:reconcile');
  return {
    text: `💳 Платежи и баланс\n\n${balanceText}\n\nАктивный премиум: ${active}. Тестовых оплат: ${tests}. На проверке: ${review}.\n\n${payments.length ? 'Выберите платёж ниже. В карточке есть кнопка возврата с отдельным подтверждением.' : 'Подтверждённых платежей пока нет.'}\nТестовые оплаты не дают премиум и учитываются отдельно.\n\nКоманды: /payments, /balance, /payment_support.`,
    reply_markup: keyboard
  };
}
export function adminPaymentDetail(payment) {
  const refunded = payment.refunded_ms != null;
  const keyboard = new InlineKeyboard();
  if (!refunded) keyboard.text(`↩️ Вернуть ${payment.stars} ⭐`, `refundask:${payment.kind}:${payment.id}`).row();
  keyboard.text('← Платежи и баланс', 'payments:home');
  return {
    text: `${payment.title}\nСумма: ${payment.stars} ⭐\nСтатус: ${refunded ? 'возвращён' : 'оплачен; возврат не выполнен'}\nПолучено: ${premiumDate(payment.paid_ms)}\nПлательщик: ID ${payment.user_id}\nЗаказ: ${payment.id}\n\n${payment.kind === 't' ? 'Премиум, лимиты и функции эта оплата не меняла. Возврат также их не меняет.' : 'При возврате отменяется срок этой покупки. Другие платежи сохраняются.'}${refunded ? '\nВозврат: ' + premiumDate(payment.refunded_ms) : '\nВозврат вернёт звёзды именно исходному плательщику.'}`,
    reply_markup: keyboard
  };
}

// Installed after the admin authorization middleware. No route executes a refund on its first click.
export function installPaymentAdminPanel(bot, store, options = {}) {
  const premium = store.premium, tests = new TestPaymentStore(store.db);
  const refunding = new Set(), confirmations = new Map();
  const privateOnly = async ctx => {
    if (ctx.chat?.type === 'private') return true;
    await ctx.reply('Платежи доступны только в личном чате администратора.'); return false;
  };
  async function deliver(ctx, view, edit = false) {
    if (edit && ctx.callbackQuery?.message) return ctx.editMessageText(view.text, {reply_markup: view.reply_markup});
    return ctx.reply(view.text, {reply_markup: view.reply_markup});
  }
  async function showPayments(ctx, edit = false) {
    if (!await privateOnly(ctx)) return;
    return deliver(ctx, await adminPaymentsView(premium, options.sourcePaymentBalance), edit);
  }
  async function showDetail(ctx, kind, id) {
    if (!await privateOnly(ctx)) return;
    const payment = findAdminPayment(premium, tests, kind, id);
    if (!payment) return ctx.reply('Оплаченный заказ не найден. /payments');
    return deliver(ctx, adminPaymentDetail(payment), true);
  }
  const confirmationKey = (ctx, p) => `${ctx.from.id}:${p.kind}:${p.id}`;
  async function askRefund(ctx, kind, id) {
    if (!await privateOnly(ctx)) return;
    const p = findAdminPayment(premium, tests, kind, id);
    if (!p) return ctx.reply('Оплаченный заказ не найден. Список: /payments');
    if (p.refunded_ms != null) return ctx.reply('Этот платёж уже возвращён. /payments');
    const now = Date.now();
    for (const [key, expiry] of confirmations) if (expiry < now) confirmations.delete(key);
    confirmations.set(confirmationKey(ctx, p), now + 10 * 60_000);
    return deliver(ctx, {
      text: `Подтвердите возврат\n\n${p.title}\nСумма: ${p.stars} ⭐\nПолучатель: исходный плательщик, ID ${p.user_id}\nЗаказ: ${p.id}\n\n${p.kind === 't' ? 'Премиум, лимиты и функции не изменятся.' : `Срок покупки (${p.days} дней) будет отменён; остальные покупки сохранятся.`}\nЗвёзды вернутся с баланса основного бота на баланс покупателя. Сейчас возврат ещё НЕ выполнен.`,
      reply_markup: new InlineKeyboard().text(`Подтвердить возврат ${p.stars} ⭐`, `${kind === 't' ? 'testrefund' : 'payrefund'}:${id}`).row().text('Отмена', 'payrefund:cancel')
    }, Boolean(ctx.callbackQuery));
  }
  async function executeRefund(ctx, kind, id) {
    if (!await privateOnly(ctx)) return;
    await ctx.answerCallbackQuery();
    const p = findAdminPayment(premium, tests, kind, id);
    if (!p || p.refunded_ms != null) return ctx.reply('Платёж уже возвращён или не найден. /payments');
    const lock = `${kind}:${id}`, key = confirmationKey(ctx, p);
    if (refunding.has(lock)) return ctx.reply('Этот возврат уже обрабатывается.');
    if ((confirmations.get(key) || 0) <= Date.now()) return ctx.reply('Подтверждение устарело. Откройте карточку платежа и ещё раз нажмите «Вернуть». /payments');
    if (!options.sourcePaymentRefund) return ctx.reply('Канал возвратов не подключён.');
    confirmations.delete(key);
    refunding.add(lock);
    let telegramConfirmed = false;
    try {
      if (options.sourcePaymentBotId && Number(await options.sourcePaymentBotId()) !== p.bot_id) throw new Error('payment_bot_mismatch');
      try {
        const ok = await options.sourcePaymentRefund(p.user_id, p.charge_id);
        if (ok !== true) throw new Error('refund_not_confirmed');
      } catch (error) {
        if (!/CHARGE_ALREADY_REFUNDED|already refunded/i.test(String(error.description || error.message))) throw error;
      }
      telegramConfirmed = true;
      if (kind === 't') tests.recordRefund(p.user_id, p.bot_id, {currency:'XTR', total_amount:p.stars, invoice_payload:tests.payload(p), telegram_payment_charge_id:p.charge_id});
      else premium.refund(p.charge_id, p.user_id);
    } catch (error) {
      await ctx.reply(telegramConfirmed
        ? 'Telegram подтвердил возврат, но местную запись пока обновить не удалось. Повторно возвращать деньги не нужно. Выполните /reconcile_payments.'
        : `Telegram не подтвердил результат возврата. Запись об оплате сохранена. Проверьте /reconcile_payments перед новой попыткой. ${safeErrorSummary(error)}`);
      return;
    } finally { refunding.delete(lock); }
    const updated = findAdminPayment(premium, tests, kind, id);
    // A notification error must never turn a confirmed refund into an apparent payment error.
    await Promise.allSettled([
      deliver(ctx, {...adminPaymentDetail(updated), text:`✅ Возвращено ${p.stars} ⭐ исходному плательщику.\n\n${adminPaymentDetail(updated).text}`}, true),
      options.sourcePaymentMessage ? options.sourcePaymentMessage(p.user_id, kind === 't'
        ? `Возврат тестовой оплаты подтверждён: ${p.stars} звёзд возвращены на ваш баланс Telegram. Премиум, лимиты и функции не менялись.`
        : `Возврат ${p.stars} Stars подтверждён. Срок премиума пересчитан. /premium`) : Promise.resolve()
    ]);
  }
  bot.command('payments', ctx => showPayments(ctx));
  bot.command('balance', ctx => showPayments(ctx));
  bot.hears(PAYMENTS_LABEL, ctx => showPayments(ctx));
  bot.callbackQuery('payments:home', async ctx => { await ctx.answerCallbackQuery(); return showPayments(ctx, true); });
  bot.callbackQuery(new RegExp(`^payment:([pt]):(${UUID})$`), async ctx => { await ctx.answerCallbackQuery(); return showDetail(ctx, ctx.match[1], ctx.match[2]); });
  bot.callbackQuery(new RegExp(`^refundask:([pt]):(${UUID})$`), async ctx => { await ctx.answerCallbackQuery(); return askRefund(ctx, ctx.match[1], ctx.match[2]); });
  bot.command('refund', ctx => {
    const id = String(ctx.match || '').trim();
    return askRefund(ctx, premium.paymentForOrder(id) ? 'p' : 't', id);
  });
  bot.callbackQuery('payrefund:cancel', async ctx => {
    if (!await privateOnly(ctx)) return;
    for (const key of confirmations.keys()) if (key.startsWith(`${ctx.from.id}:`)) confirmations.delete(key);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('Возврат отменён. Деньги не возвращались.', {reply_markup:new InlineKeyboard().text('← Платежи и баланс','payments:home')});
  });
  bot.callbackQuery(new RegExp(`^payrefund:(${UUID})$`), ctx => executeRefund(ctx, 'p', ctx.match[1]));
  bot.callbackQuery(new RegExp(`^testrefund:(${UUID})$`), ctx => executeRefund(ctx, 't', ctx.match[1]));
}
