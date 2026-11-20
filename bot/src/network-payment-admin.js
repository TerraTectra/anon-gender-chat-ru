import { InlineKeyboard } from 'grammy';
import { anonVariants, anonVariantDbPath } from './anon-variants.js';
import { Store } from './store.js';
import { installPaymentAdminPanel, PAYMENTS_LABEL } from './payment-admin-panel.js';
import { paymentConfiguration } from './premium-pricing.js';
import { safeErrorSummary } from './safe-error.js';

export function premiumMetrics(premium, now = Date.now()) {
  const since = now - 7 * 86400000;
  const event = type => premium.db.prepare('SELECT COUNT(DISTINCT user_id) n FROM premium_events WHERE type=? AND created_ms>=?').get(type,since).n;
  const paid = premium.db.prepare('SELECT COUNT(*) purchases,COUNT(DISTINCT user_id) buyers,COALESCE(SUM(stars),0) gross,COALESCE(SUM(CASE WHEN refunded_ms IS NOT NULL THEN stars ELSE 0 END),0) refunded FROM premium_payments WHERE paid_ms>=?').get(since);
  const views=event('menu_view');
  const converted=premium.db.prepare("SELECT COUNT(DISTINCT p.user_id) n FROM premium_payments p WHERE p.paid_ms>=? AND EXISTS(SELECT 1 FROM premium_events e WHERE e.user_id=p.user_id AND e.type='menu_view' AND e.created_ms>=? AND e.created_ms<=p.paid_ms)").get(since,since).n;
  return { views, orders:event('order_created'), accepted:event('terms_accepted'), ...paid,converted,conversion:views?Math.round(converted/views*1000)/10:null,
    active:premium.db.prepare('SELECT COUNT(*) n FROM premium_access WHERE until_ms>?').get(now).n,
    review:premium.db.prepare('SELECT COUNT(*) n FROM payment_anomalies').get().n };
}

// A Telegram balance is different from the cumulative payment ledger.
export function starNanoAmount(value) {
  if (!Number.isSafeInteger(value?.amount) ||
      !Number.isInteger(value.nanostar_amount ?? 0) ||
      Math.abs(value.nanostar_amount ?? 0) >= 1_000_000_000) {
    throw new Error('invalid_star_balance');
  }
  return BigInt(value.amount) * 1_000_000_000n + BigInt(value.nanostar_amount ?? 0);
}

export function formatNanoStars(nano) {
  const n = BigInt(nano);
  const abs = n < 0n ? -n : n;
  const whole = abs / 1_000_000_000n;
  const fraction = (abs % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return (n < 0n ? '−' : '') + whole.toString() + (fraction ? ',' + fraction : '');
}

export async function networkStarBalances(brands, balanceProvider) {
  const entries = await Promise.all(brands.map(async brand => {
    try {
      return { ...brand, nano: starNanoAmount(await balanceProvider(brand.id)), available: true };
    } catch {
      return { ...brand, nano: null, available: false };
    }
  }));
  const complete = entries.every(item => item.available);
  const totalNano = entries.reduce((sum, item) => sum + (item.nano ?? 0n), 0n);
  return { entries, complete, totalNano, connected: entries.filter(item => item.available).length };
}

export function allTimePaymentTotals(premium) {
  const row = premium.db.prepare(`
    SELECT COUNT(*) AS purchases,
           COALESCE(SUM(stars), 0) AS received,
           COALESCE(SUM(CASE WHEN refunded_ms IS NOT NULL THEN stars ELSE 0 END), 0) AS refunded
    FROM premium_payments
  `).get();
  return { purchases: Number(row.purchases), received: Number(row.received),
    refunded: Number(row.refunded), net: Number(row.received) - Number(row.refunded) };
}

// Registered only after the existing ADMIN_IDS middleware. All money operations
// use the selected bot API and its own database; no token enters callback data.
export function installNetworkPaymentAdmin(bot, original, options = {}) {
  const brands = [{ id:'anon',name:'Основной чат',username:'anon_gender_chat_ru_bot' },...anonVariants];
  const stores = new Map([['anon',original]]);
  for (const b of anonVariants) stores.set(b.id,new Store(anonVariantDbPath(b.id),{
    sessionArchiveRoot:`./data/anon-variants/session-archive/${b.id}`
  }));
  const api = (id, action, ...args) => {
    if (!options.networkPaymentAction) throw new Error('payment_bot_unavailable');
    return options.networkPaymentAction(id,action,...args);
  };
  const privateOnly = async ctx => {
    if (ctx.chat?.type === 'private') return true;
    await ctx.reply('Платежи доступны только в личном чате администратора.');return false;
  };
  const back = () => new InlineKeyboard().text('← Платежи всех ботов','payments:network');
  const readBalances = () => networkStarBalances(brands, id => api(id,'balance'));
  async function dashboard(ctx,edit=false) {
    if(!await privateOnly(ctx))return;
    const summary = await readBalances();
    const balance = summary.complete
      ? formatNanoStars(summary.totalNano) + ' ⭐'
      : 'не удалось подтвердить (доступно ' + summary.connected + ' из ' + brands.length + ' ботов)';
    const keyboard = new InlineKeyboard()
      .text('📊 По ботам', 'payments:network_breakdown').row()
      .text('🧾 Платежи и возвраты', 'payments:network_manage').row()
      .text('✉️ Обращения', 'payments:network_support')
      .text('🔄 Обновить', 'payments:network');
    const message = '💳 Баланс сети Telegram Stars\n\n' + balance
      + '\n\n' + (summary.complete
        ? 'Сумма текущих балансов всех девяти ботов по данным Telegram.'
        : 'Неизвестные балансы НЕ приравниваются к нулю. Проверить отдельные суммы можно в разделе «По ботам».');
    return edit ? ctx.editMessageText(message,{reply_markup:keyboard})
      : ctx.reply(message,{reply_markup:keyboard});
  }
  async function breakdown(ctx,edit=false) {
    if(!await privateOnly(ctx))return;
    const summary = await readBalances();
    const rows = summary.entries.map(item => {
      const ledger = allTimePaymentTotals(stores.get(item.id).premium);
      return item.name + '\nБаланс: ' + (item.available ? formatNanoStars(item.nano) + ' ⭐' : 'недоступен')
        + '\nЗа всё время поступило: ' + ledger.received + ' ⭐ · возвращено: ' + ledger.refunded
        + ' ⭐ · чистые поступления: ' + ledger.net + ' ⭐';
    });
    const keyboard = new InlineKeyboard()
      .text('🔄 Обновить', 'payments:network_breakdown').row()
      .text('← Общий баланс', 'payments:network');
    const message = '📊 Платежи по ботам\n\n' + rows.join('\n\n')
      + '\n\nБаланс — текущие звёзды в Telegram. Поступления — записи подтверждённых платежей, за вычетом возвратов; они не равны балансу.';
    return edit ? ctx.editMessageText(message,{reply_markup:keyboard})
      : ctx.reply(message,{reply_markup:keyboard});
  }
  async function paymentManagement(ctx,edit=false) {
    if(!await privateOnly(ctx))return;
    const keyboard = new InlineKeyboard();
    for(const b of brands) keyboard.text(b.name,
      b.id==='anon' ? 'payments:home' : 'np:' + b.id + ':payments:home').row();
    keyboard.text('← Общий баланс','payments:network');
    const message = '🧾 Выберите бота для просмотра платежей и подтверждаемых возвратов.';
    return edit ? ctx.editMessageText(message,{reply_markup:keyboard})
      : ctx.reply(message,{reply_markup:keyboard});
  }
  async function support(ctx,id=null){
    if(!await privateOnly(ctx))return;
    const selected=id?brands.filter(b=>b.id===id):brands;
    const rows=selected.flatMap(b=>stores.get(b.id).premium.openSupport().map(t=>({b,t}))).sort((a,b)=>b.t.created_ms-a.t.created_ms).slice(0,10);
    await ctx.reply(rows.length?rows.map(({b,t})=>`${b.name} · ${b.id} · №${t.id} · ID ${t.user_id}\n${t.text.slice(0,150)}`).join('\n\n')+'\n\nОтвет: /payreply_chat бот номер текст\nЗакрыть: /payclose_chat бот номер':'Открытых обращений нет.',{reply_markup:back()});
  }
  bot.command('payments',ctx=>dashboard(ctx));
  bot.command('balance',ctx=>dashboard(ctx));
  bot.hears(PAYMENTS_LABEL,ctx=>dashboard(ctx));
  bot.callbackQuery('payments:network',async ctx=>{await ctx.answerCallbackQuery();return dashboard(ctx,true);});
  bot.callbackQuery('payments:network_breakdown',async ctx=>{await ctx.answerCallbackQuery();return breakdown(ctx,true);});
  bot.callbackQuery('payments:network_manage',async ctx=>{await ctx.answerCallbackQuery();return paymentManagement(ctx,true);});
  bot.command('payment_support',ctx=>support(ctx));
  bot.callbackQuery('payments:network_support',async ctx=>{await ctx.answerCallbackQuery();return support(ctx);});
  bot.command('payreply_chat',async ctx=>{
    if(!await privateOnly(ctx))return;
    const match=String(ctx.match||'').match(/^(anon|english|focus|game|budget|hub|task|quiz|party)\s+(\d+)\s+([\s\S]{1,2000})$/);
    if(!match)return ctx.reply('Формат: /payreply_chat бот номер ответ');
    const ticket=stores.get(match[1]).premium.db.prepare('SELECT * FROM payment_support WHERE id=?').get(Number(match[2]));
    if(!ticket)return ctx.reply('Обращение в этом боте не найдено.');
    try{await api(match[1],'message',ticket.user_id,`Ответ по обращению №${ticket.id}:\n${match[3]}`);await ctx.reply('Ответ отправлен через выбранного бота.');}
    catch{return ctx.reply('Ответ не доставлен. Обращение остаётся открытым.');}
  });
  bot.command('payclose_chat',async ctx=>{
    if(!await privateOnly(ctx))return;
    const match=String(ctx.match||'').match(/^(anon|english|focus|game|budget|hub|task|quiz|party)\s+(\d+)$/);
    if(!match)return ctx.reply('Формат: /payclose_chat бот номер');
    const result=stores.get(match[1]).premium.db.prepare('UPDATE payment_support SET resolved_ms=? WHERE id=? AND resolved_ms IS NULL').run(Date.now(),Number(match[2]));
    await ctx.reply(result.changes?'Обращение закрыто.':'Обращение уже закрыто или не найдено.');
  });
  for(const b of anonVariants){
    const prefix=`np:${b.id}:`;
    installPaymentAdminPanel(bot,stores.get(b.id),{
      paymentPrefix:prefix,paymentName:b.name+' · @'+b.username,
      sourcePaymentBalance:()=>api(b.id,'balance'),sourcePaymentBotId:()=>api(b.id,'botId'),
      sourcePaymentRefund:(...args)=>api(b.id,'refund',...args),sourcePaymentMessage:(...args)=>api(b.id,'message',...args)
    });
    bot.callbackQuery(prefix+'payments:support',async ctx=>{await ctx.answerCallbackQuery();return support(ctx,b.id);});
    bot.callbackQuery(prefix+'payments:reconcile',async ctx=>{
      if(!await privateOnly(ctx))return;
      await ctx.answerCallbackQuery();
      try{const r=await api(b.id,'reconcile');await ctx.reply(`${b.name}\nСверка: восстановлено ${r.restored}, возвратов ${r.refunded}, проверок ${r.review}. ${r.complete?'Круг завершён.':'Продолжится со следующей страницы.'}`,{reply_markup:back()});}
      catch(error){await ctx.reply('Сверка не завершена: '+safeErrorSummary(error),{reply_markup:back()});}
    });
  }
  return {close(){for(const [id,s]of stores)if(id!=='anon')s.close();}};
}
