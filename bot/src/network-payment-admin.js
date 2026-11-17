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
  async function dashboard(ctx,edit=false) {
    if(!await privateOnly(ctx))return;
    const rows=[];const keyboard=new InlineKeyboard();
    for(const b of brands){
      const m=premiumMetrics(stores.get(b.id).premium);
      const plans=Object.values(paymentConfiguration(b.id).plans).map(p=>`${p.days}д ${p.stars}⭐`).join(' · ');
      rows.push(`${b.name}\n@${b.username}\n${plans}\nЗа 7д: меню ${m.views}, заказчики ${m.orders}, согласия ${m.accepted}, покупателей ${m.buyers}, оплат ${m.purchases}; получено ${m.gross}⭐, из них возвращено ${m.refunded}⭐. Активных ${m.active}, проверок ${m.review}.\nМеню → покупка: ${m.converted}/${m.views} (${m.conversion===null?'нет данных':m.conversion+'%'}).`);
      keyboard.text(b.name,b.id==='anon'?'payments:home':`np:${b.id}:payments:home`).row();
    }
    keyboard.text('Обращения всех ботов','payments:network_support').row().text('Обновить','payments:network');
    const text='💳 Платежи всех 9 ботов · Telegram Stars\n\n'+rows.join('\n\n')+'\n\nСчётчики относятся к каждому боту отдельно. Это эксперимент брендов и цен, не случайное распределение пользователей. Конверсия по малой выборке не доказывает влияние цены. Живой баланс и возврат — в карточке бота.';
    return edit?ctx.editMessageText(text,{reply_markup:keyboard}):ctx.reply(text,{reply_markup:keyboard});
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
