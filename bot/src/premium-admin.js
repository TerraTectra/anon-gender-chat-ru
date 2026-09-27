import { InlineKeyboard } from 'grammy';
import { premiumDate } from './premium-bot.js';
import { safeErrorSummary } from './safe-error.js';

// Install only AFTER the administrative authorization middleware.
export function installPremiumAdmin(bot,store,options={}) {
 const premium=store.premium,refunding=new Set();
 const privateOnly=async ctx=>{if(ctx.chat?.type==='private')return true;await ctx.reply('Платежи доступны только в личном чате администратора.');return false;};
 bot.command('payments',async ctx=>{
  if(!await privateOnly(ctx))return;
  const list=premium.recentPayments();
  const active=premium.db.prepare('SELECT COUNT(*) n FROM premium_access WHERE until_ms>?').get(Date.now()).n;
  const review=premium.db.prepare('SELECT COUNT(*) n FROM payment_anomalies').get().n;
  await ctx.reply(`Премиум: ${active} активных. Требуют проверки: ${review}.\n\n${list.length?list.map(p=>`${p.order_id}\nID ${p.user_id} · ${p.days} дней · ${p.stars} Stars · ${p.refunded_ms?'возвращён':'оплачен'}\n${premiumDate(p.paid_ms)}`).join('\n\n'):'Платежей пока нет.'}\n\nВозврат: /refund номер-заказа\nОбращения: /payment_support\nСверить с Telegram: /reconcile_payments`);
 });
 bot.command('payment_support',async ctx=>{
  if(!await privateOnly(ctx))return;
  const tickets=premium.openSupport();
  await ctx.reply(tickets.length?tickets.map(t=>`№${t.id} · ID ${t.user_id}\n${t.text.slice(0,200)}`).join('\n\n')+'\n\nОтвет: /payreply номер текст\nЗакрыть: /payclose номер':'Открытых обращений нет.');
 });
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
 bot.command('refund',async ctx=>{
  if(!await privateOnly(ctx))return;
  const id=String(ctx.match).trim();
  const payment=premium.paymentForOrder(id);
  if(!payment)return ctx.reply('Оплаченный заказ не найден. Список: /payments');
  if(payment.refunded_ms)return ctx.reply('Этот платёж уже возвращён.');
  await ctx.reply(`Вернуть ${payment.stars} Stars пользователю ID ${payment.user_id}?\nЗаказ ${id}.\nОплаченные этим заказом ${payment.days} дней будут отменены. Другие покупки не удаляются.`,{reply_markup:new InlineKeyboard().text('Подтвердить возврат',`payrefund:${id}`).row().text('Отмена','payrefund:cancel')});
 });
 bot.callbackQuery('payrefund:cancel',async ctx=>{await ctx.answerCallbackQuery();await ctx.editMessageText('Возврат отменён.');});
 bot.callbackQuery(/^payrefund:([0-9a-f-]{36})$/,async ctx=>{
  if(!await privateOnly(ctx))return;
  const id=ctx.match[1],p=premium.paymentForOrder(id);
  await ctx.answerCallbackQuery();
  if(!p||p.refunded_ms)return ctx.reply('Платёж уже возвращён или не найден.');
  if(refunding.has(id))return ctx.reply('Этот возврат уже обрабатывается.');
  if(!options.sourcePaymentRefund)return ctx.reply('Канал возвратов не подключён.');
  refunding.add(id);
  try{
   try{await options.sourcePaymentRefund(p.user_id,p.charge_id);}
   catch(error){if(!/CHARGE_ALREADY_REFUNDED|already refunded/i.test(String(error.description||error.message)))throw error;}
   premium.refund(p.charge_id,p.user_id);
   await ctx.editMessageText(`Возвращено ${p.stars} Stars. Заказ ${id}.`);
   await options.sourcePaymentMessage?.(p.user_id,`Возврат ${p.stars} Stars подтверждён. Срок премиума пересчитан. /premium`).catch(()=>{});
  }catch(error){await ctx.reply(`Telegram не подтвердил результат возврата. Проверьте /reconcile_payments перед повтором. ${safeErrorSummary(error)}`);}
  finally{refunding.delete(id);}
 });
 bot.command('reconcile_payments',async ctx=>{
  if(!await privateOnly(ctx))return;
  if(!options.sourcePaymentReconcile)return ctx.reply('Сверка не подключена.');
  try{const r=await options.sourcePaymentReconcile();await ctx.reply(`Сверка завершена. Восстановлено: ${r.restored}. Возвратов обработано: ${r.refunded}. На проверку: ${r.review}.`);}
  catch(error){await ctx.reply(`Сверка не завершена: ${safeErrorSummary(error)}`);}
 });
}
