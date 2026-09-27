import { InlineKeyboard } from 'grammy';
import { safeErrorSummary } from './safe-error.js';
import { installPaymentAdminPanel } from './payment-admin-panel.js';

// Install only AFTER the administrative authorization middleware.
export function installPremiumAdmin(bot, store, options = {}) {
 const premium = store.premium;
 const privateOnly = async ctx => {
  if(ctx.chat?.type === 'private') return true;
  await ctx.reply('Платежи доступны только в личном чате администратора.');return false;
 };
 installPaymentAdminPanel(bot, store, options);
 const back = () => new InlineKeyboard().text('💳 Платежи и возвраты', 'payments:home');
 async function showSupport(ctx) {
  if(!await privateOnly(ctx))return;
  const tickets=premium.openSupport();
  await ctx.reply(tickets.length?tickets.map(t=>`№${t.id} · ID ${t.user_id}\n${t.text.slice(0,200)}`).join('\n\n')+'\n\nОтвет: /payreply номер текст\nЗакрыть: /payclose номер\nВозврат: нажмите «Платежи и возвраты», выберите оплату, затем «Вернуть».':'Открытых обращений нет.',{reply_markup:back()});
 }
 bot.command('payment_support',showSupport);
 bot.callbackQuery('payments:support',async ctx=>{await ctx.answerCallbackQuery();return showSupport(ctx);});
 bot.command('payreply',async ctx=>{
  if(!await privateOnly(ctx))return;
  const match=String(ctx.match).match(/^(\d+)\s+([\s\S]{1,2000})$/);
  if(!match)return ctx.reply('Формат: /payreply номер-обращения ответ');
  const ticket=premium.db.prepare('SELECT * FROM payment_support WHERE id=?').get(Number(match[1]));
  if(!ticket)return ctx.reply('Обращение не найдено.');
  if(!options.sourcePaymentMessage)return ctx.reply('Канал ответа не подключён.');
  try{await options.sourcePaymentMessage(ticket.user_id,`Ответ по обращению №${ticket.id}:\n${match[2]}`);await ctx.reply('Ответ отправлен.');}
  catch{return ctx.reply('Ответ не доставлен. Обращение не закрыто; возможно, пользователь заблокировал бота.');}
 });
 bot.command('payclose',async ctx=>{
  if(!await privateOnly(ctx))return;
  if(!/^\d+$/.test(String(ctx.match)))return ctx.reply('Формат: /payclose номер');
  const result=premium.db.prepare('UPDATE payment_support SET resolved_ms=? WHERE id=? AND resolved_ms IS NULL').run(Date.now(),Number(ctx.match));
  await ctx.reply(result.changes?'Обращение закрыто.':'Обращение уже закрыто или не найдено.');
 });
 async function reconcile(ctx){
  if(!await privateOnly(ctx))return;
  if(!options.sourcePaymentReconcile)return ctx.reply('Сверка не подключена.');
  try{const r=await options.sourcePaymentReconcile();await ctx.reply(`${r.complete===false?'Часть сверки завершена; следующая часть продолжится автоматически.':'Сверка завершена.'} Восстановлено: ${r.restored}. Возвратов обработано: ${r.refunded}. На проверку: ${r.review}.`,{reply_markup:back()});}
  catch(error){await ctx.reply(`Сверка не завершена: ${safeErrorSummary(error)}`,{reply_markup:back()});}
 }
 bot.command('reconcile_payments',reconcile);
 bot.callbackQuery('payments:reconcile',async ctx=>{await ctx.answerCallbackQuery();return reconcile(ctx);});
}
