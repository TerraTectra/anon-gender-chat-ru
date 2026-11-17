import { InlineKeyboard } from 'grammy';
import { labels, menuKeyboard } from './keyboards.js';
import { safeErrorSummary } from './safe-error.js';
import { readPaymentBatch } from './payment-reconciliation.js';

const ready = user => Boolean(user?.gender && user?.age);
export const premiumDate = timestamp => new Date(timestamp).toLocaleString('ru-RU', {timeZone:'Europe/Moscow',dateStyle:'medium',timeStyle:'short'}) + ' МСК';
export const TERMS_TEXT = `Премиум анонимного чата\n\nБезлимитные совпадения с фильтрами пола и возраста на оплаченный срок. Просмотр указанных пола и возраста собеседника — только если он разрешил их показывать. Это не проверенные документы: сведения вводит сам пользователь. Имя, username и Telegram ID собеседника не раскрываются.\n\n7 дней — 25 Stars; 30 дней — 75 Stars; 90 дней — 180 Stars. Платёж разовый, без автопродления. Новая покупка продлевает действующий срок. После окончания остаются бесплатные функции и 50 совпадений с фильтрами в сутки.\n\nПремиум не гарантирует наличие подходящих людей онлайн, не снимает блокировки и не смешивает группы 12–17 и 18+. Правила чата действуют для всех.\n\nПокупайте только при наличии права распоряжаться оплатой; несовершеннолетним нужно разрешение родителя. По ошибкам оплаты, недоступности услуги и возвратам: /paysupport описание проблемы. Обращения рассматривает владелец бота, не поддержка Telegram. Платёжные записи сохраняются для доступа, поддержки и возвратов.\n\nНажимая «Принимаю условия», вы соглашаетесь с этими условиями. Оплата подтверждается отдельно в окне Telegram.`;
export const VISIBILITY_TEXT = 'Показывать ваш пол и возраст собеседнику с премиумом?\n\nПо умолчанию они скрыты. Можно разрешить или запретить показ бесплатно в любой момент: /visibility. Это не открывает ваше имя, username или Telegram ID. Уже увиденные сведения отозвать невозможно.';
export const visibilityKeyboard = () => new InlineKeyboard().text('Разрешить показ','visibility:yes').row().text('Скрывать','visibility:no');
export function premiumTerms(premium,options={}) {
 const priceLine=Object.values(premium.plans).map(p=>`${p.days} дней — ${p.stars} Stars`).join('; ')+'.';
 let text=TERMS_TEXT.replace('7 дней — 25 Stars; 30 дней — 75 Stars; 90 дней — 180 Stars.',priceLine);
 if(options.adultOnly)text=text.replace('Покупайте только при наличии права распоряжаться оплатой; несовершеннолетним нужно разрешение родителя.',
  'Покупка premium в этом боте доступна только с 18 лет при наличии права распоряжаться оплатой. Несовершеннолетним доступен бесплатный чат. Возраст указан пользователем и не проверен документами.');
 if(options.brandName)text=options.brandName+'\n\n'+text;
 if(options.adultOnly)text+='\n\nТарифы эксперимента постоянны для каждого бренда и могут отличаться между ботами. Premium действует только в этом боте. Цена заказа фиксируется на 15 минут. Лимит покупок — 18 000 Stars за скользящие 24 часа в этом боте, включая возвращённые покупки; максимум 365 оплаченных дней вперёд. Нет автоматического повышения цены и автопродления. Версия условий: '+premium.options.termsVersion+'.';
 return text;
}
export function partnerSummary(store,viewerId,partnerId) {
  if (!store.premium.active(viewerId)) return '';
  const viewer=store.getUser(viewerId),partner=store.getUser(partnerId);
  if(!ready(viewer)||!ready(partner)||viewer.partner_id!==partnerId||partner.partner_id!==viewerId||(viewer.age<18)!==(partner.age<18))return '';
  if(store.premium.visibility(partnerId)!==true)return '\nПол и возраст скрыты собеседником.';
  return `\nАнкета собеседника: ${partner.gender==='male'?'парень':'девушка'}, ${partner.age} лет. Сведения указаны пользователем.`;
}
export function invoiceParameters(premium,order,chatId){
 return {chat_id:chatId,title:`Премиум • ${order.days} дней`,description:`${order.stars} Stars за ${order.days} дней в этом боте. Безлимитный поиск с фильтрами; анкета только с согласия собеседника. Разовый платёж, без автосписаний.`,payload:premium.payload(order),provider_token:'',currency:'XTR',prices:[{label:`Премиум на ${order.days} дней`,amount:order.stars}],start_parameter:'premium'};
}

export function installPremium(bot,store,options={}) {
 const premium=store.premium;
 const terms=()=>premiumTerms(premium,options);
 const purchaseAllowed=ctx=>!options.adultOnly||store.getUser(ctx.from.id)?.age>=18;
 const ageNotice='Покупки premium в этом боте доступны только с 18 лет. Бесплатный чат остаётся доступным по правилам возрастных групп.';
 const brandPrefix=options.brandName?options.brandName+'\n':'';
 const admins=String(options.adminIds||'').split(',').map(Number).filter(id=>Number.isSafeInteger(id)&&id>0);
 async function notifyAdmins(text){await Promise.allSettled(admins.map(id=>bot.paymentAdminNotifier?bot.paymentAdminNotifier(id,text):bot.api.sendMessage(id,text)));}
 async function showPremium(ctx){
  if(options.disableSales) return ctx.reply('В тестовой версии этого чата платные функции временно отключены. Случайный поиск бесплатный, фильтры доступны до 50 совпадений в сутки.');
  if(ctx.chat?.type!=='private')return ctx.reply('Премиум доступен в личном чате с ботом.');
  const until=premium.until(ctx.from.id);
  premium.event(ctx.from.id,'menu_view');
  const status=until>Date.now()?`Действует до ${premiumDate(until)}.`:'Сейчас у вас бесплатный доступ.';
  const keyboard=new InlineKeyboard();
  for(const [key,plan] of Object.entries(premium.plans))keyboard.text(`${plan.label} · ${plan.stars} ⭐`,`premium:plan:${key}`).row();
  keyboard.text('Условия','premium:terms');
  await ctx.reply(`${brandPrefix}⭐ Премиум\n${status}\n\nБезлимитный поиск по полу и возрасту. Просмотр пола и возраста собеседника, если он разрешил показ: /partner.\n\nБез автосписаний. Бесплатный случайный поиск и 50 совпадений с фильтрами в сутки остаются. Количество подходящих людей премиум не увеличивает.${options.adultOnly?'\n\nПокупки только с 18 лет. Доступ действует в этом боте. Цена выбранного заказа фиксируется на 15 минут.':''}\n\nВыберите срок:`,{reply_markup:keyboard});
 }
 async function showVisibility(ctx){
  if(ctx.chat?.type!=='private')return;
  if(!ready(store.getUser(ctx.from.id)))return ctx.reply('Сначала заполните профиль: /start.');
  const value=premium.visibility(ctx.from.id);
  await ctx.reply(`${VISIBILITY_TEXT}\n\nСейчас: ${value===true?'показ разрешён':'скрыто'}.`,{reply_markup:visibilityKeyboard()});
 }
 async function support(ctx){
  if(ctx.chat?.type!=='private')return;
  const problem=String(ctx.match||'').trim();
  if(!problem)return ctx.reply('Помощь с премиумом и возвратами: отправьте /paysupport и описание проблемы одним сообщением. Обращение получит владелец бота. Не присылайте пароли, коды входа и данные карты.\nПример: /paysupport Оплата прошла, но премиум не появился.');
  const ticket=premium.addSupport(ctx.from.id,problem);
  await ctx.reply(ticket.limited?`Обращение №${ticket.id} уже сохранено. Подождите минуту перед новым обращением.`:`Обращение №${ticket.id} сохранено. Владелец ответит вам через этого бота.`);
  if(!ticket.limited)await notifyAdmins(`${brandPrefix}Оплата: обращение №${ticket.id}\nПользователь ID ${ctx.from.id}\n${problem.slice(0,2000)}\n\nОтвет: ${options.brandId&&options.brandId!=='anon'?'/payreply_chat '+options.brandId:'/payreply'} ${ticket.id} текст\nВсе обращения: /payment_support`);
 }

 // Payment service updates bypass chat/session queues and bans. Checkout must be answered in under 10 seconds.
 bot.on('pre_checkout_query',async ctx=>{
  if(options.disableSales) return ctx.answerPreCheckoutQuery(false,{error_message:'Платные функции отключены на время эксперимента.'});
  let ok=true;
  try{
   if(store.isBanned(ctx.from.id)||!ready(store.getUser(ctx.from.id))||!purchaseAllowed(ctx))throw new Error('profile_unavailable');
   premium.approve(ctx.from.id,ctx.me.id,ctx.preCheckoutQuery);
  }catch{ok=false;}
  await ctx.answerPreCheckoutQuery(ok,ok?{}:{error_message:'Счёт недоступен, устарел или уже обрабатывается. Проверьте /premium и создайте новый счёт. Деньги по этому запросу не приняты.'});
 });
 bot.on('message:successful_payment',async ctx=>{
  const payment=ctx.message.successful_payment;
  let result;
  try{result=premium.applyPayment(ctx.from.id,ctx.me.id,payment);}
  catch(error){
   premium.anomaly(ctx.from.id,payment,error.message);
   await Promise.allSettled([ctx.reply('Платёж получен, но требует проверки. Отправьте /paysupport с описанием; запись платежа сохранена.'),notifyAdmins(`Платёж требует проверки. Пользователь ID ${ctx.from.id}. Причина: ${error.message}. /payments`)]);
   return;
  }
  if(result.duplicate||result.refunded)return;
  await Promise.allSettled([
   ctx.reply(`⭐ Премиум включён до ${premiumDate(result.until)}.\nФильтры без лимита: /filters. Анкета собеседника: /partner. Поддержка: /paysupport.`,{reply_markup:menuKeyboard}),
   notifyAdmins(`${brandPrefix}Покупка премиума: ${result.order.days} дней за ${result.order.stars} Stars.\nЗаказ ${result.order.id}\nУправление: /payments`)
  ]);
 });
 bot.on('message:refunded_payment',async ctx=>{
  const payment=ctx.message.refunded_payment;
  const userId=ctx.chat.id;
  try{premium.recordRefund(userId,ctx.me.id,payment);}
  catch(error){premium.anomaly(userId,payment,`refund:${error.message}`);await notifyAdmins(`Возврат требует проверки: ID ${userId}. /payments`);}
 });
 bot.command('paysupport',support);
 bot.command('support',support);
 bot.command('terms',ctx=>ctx.reply(terms()));
 bot.command('premium',showPremium);
 bot.hears(labels.premium,showPremium);
 bot.callbackQuery('premium:terms',async ctx=>{await ctx.answerCallbackQuery();await ctx.reply(terms());});
 bot.callbackQuery(/^premium:plan:(week|month|quarter)$/,async ctx=>{
   if(options.disableSales) return ctx.answerCallbackQuery({text:'Платные функции отключены на время эксперимента.',show_alert:true});
  await ctx.answerCallbackQuery();
  if(ctx.chat?.type!=='private')return;
  if(store.isBanned(ctx.from.id))return ctx.reply('Доступ к чату ограничен. По оплате: /paysupport.');
  if(!ready(store.getUser(ctx.from.id)))return ctx.reply('Сначала заполните профиль: /start. Затем откройте /premium.');
  if(!purchaseAllowed(ctx))return ctx.reply(ageNotice);
  const recent=premium.db.prepare('SELECT id FROM premium_orders WHERE user_id=? AND created_ms>?').get(ctx.from.id,Date.now()-3000);
  if(recent)return ctx.reply('Счёт уже готовится. Используйте последнюю кнопку подтверждения или повторите через несколько секунд.');
  let order;
  try{order=premium.createOrder(ctx.from.id,ctx.me.id,ctx.match[1],Date.now(),store.getUser(ctx.from.id).age);}
  catch{return ctx.reply('Новый заказ пока недоступен: завершается предыдущая оплата либо достигнут лимит 18 000 Stars за 24 часа или 365 дней вперёд. Подождите и проверьте /premium. По ошибкам: /paysupport.');}
  const warning=options.adultOnly&&order.stars>=750?'\n\nВнимание: высокая стоимость. Проверьте количество Stars перед подтверждением. Те же функции доступны по разным тарифам у других брендов эксперимента.':'';
  await ctx.reply(`${terms()}\n\nВы выбрали ${order.days} дней за ${order.stars} Stars.${warning}`,{reply_markup:new InlineKeyboard().text(options.adultOnly?`Мне 18+, принимаю · ${order.stars} ⭐`:'Принимаю условия',`premium:accept:${order.id}`).row().text('Отмена',`premium:cancel:${order.id}`)});
 });
 bot.callbackQuery('premium:cancel',async ctx=>{await ctx.answerCallbackQuery('Покупка отменена');await ctx.editMessageText('Покупка отменена. Деньги не списаны. /premium');});
 bot.callbackQuery(/^premium:cancel:([0-9a-f-]{36})$/,async ctx=>{
  if(ctx.chat?.type!=='private')return;
  premium.cancelOrder(ctx.from.id,ctx.match[1]);await ctx.answerCallbackQuery('Покупка отменена');
  await ctx.editMessageText('Покупка отменена. Деньги не списаны. /premium');
 });
 bot.callbackQuery(/^premium:accept:([0-9a-f-]{36})$/,async ctx=>{
  await ctx.answerCallbackQuery();
  if(ctx.chat?.type!=='private'||store.isBanned(ctx.from.id))return;
  if(options.disableSales)return ctx.reply('Продажи временно отключены. Поддержка и возвраты доступны: /paysupport.');
  if(!purchaseAllowed(ctx))return ctx.reply(ageNotice);
  let order;
  try{order=premium.acceptOrder(ctx.from.id,ctx.me.id,ctx.match[1],Date.now(),Boolean(options.adultOnly));if(options.adultOnly)premium.claimInvoice(order.id);}
  catch{return ctx.reply('Счёт устарел или уже оплачен. Откройте /premium.');}
  await ctx.api.raw.sendInvoice(invoiceParameters(premium,order,ctx.chat.id));
 });
 bot.command('visibility',showVisibility);
 bot.callbackQuery(/^visibility:(yes|no)$/,async ctx=>{
  if(ctx.chat?.type!=='private'||!ready(store.getUser(ctx.from.id)))return ctx.answerCallbackQuery('Сначала заполните профиль: /start');
  premium.setVisibility(ctx.from.id,ctx.match[1]==='yes');
  await ctx.answerCallbackQuery('Сохранено');
  await ctx.editMessageText(`Пол и возраст ${ctx.match[1]==='yes'?'видны собеседнику с премиумом':'скрыты от собеседников'}. Изменить: /visibility.`);
 });
 async function showPartner(ctx){
  if(ctx.chat?.type!=='private')return;
  if(store.isBanned(ctx.from.id))return;
  if(!premium.active(ctx.from.id))return showPremium(ctx);
  const user=store.getUser(ctx.from.id);
  if(!user?.partner_id)return ctx.reply('Сейчас нет активного собеседника. /search');
  await ctx.reply(partnerSummary(store,ctx.from.id,user.partner_id).trim()||'Собеседник уже сменился. Повторите /partner.');
 }
 bot.command('partner',showPartner);
 bot.hears(labels.partner,showPartner);

 let reconcileTimer=null,initialTimer=null,reconcilePromise=null;
 async function reconcile(){
  if(reconcilePromise)return reconcilePromise;
  reconcilePromise=(async()=>{
   const offset=Number(premium.db.prepare("SELECT next_offset FROM premium_sync_state WHERE name='stars'").get()?.next_offset||0);
   const batch=await readPaymentBatch(bot.api,offset);
   const all=batch.transactions;
   const summary={restored:0,refunded:0,review:0,complete:batch.complete,nextOffset:batch.nextOffset};
   all.sort((a,b)=>a.date-b.date);
   for(const tx of all){
    const source=tx.source,receiver=tx.receiver;
    if(source?.type==='user'&&source.transaction_type==='invoice_payment'&&source.invoice_payload?.startsWith('premium:v1:')){
     const payment={currency:'XTR',total_amount:tx.amount,invoice_payload:source.invoice_payload,telegram_payment_charge_id:tx.id};
     try{const r=premium.applyPayment(source.user.id,bot.botInfo.id,payment,tx.date*1000);if(!r.duplicate&&!r.refunded){summary.restored++;await bot.api.sendMessage(source.user.id,`Платёж восстановлен. Премиум до ${premiumDate(r.until)}.`).catch(()=>{});}}
     catch(error){summary.review++;premium.anomaly(source.user.id,payment,error.message);}
    }else if(receiver?.type==='user'&&receiver.transaction_type==='invoice_payment'){
     const known=premium.db.prepare('SELECT order_id FROM premium_payments WHERE charge_id=? AND user_id=?').get(tx.id,receiver.user.id);
     const invoicePayload=receiver.invoice_payload||(known?premium.payload(premium.order(known.order_id)):null);
     if(!invoicePayload?.startsWith('premium:v1:'))continue;
     const payment={currency:'XTR',total_amount:Math.abs(tx.amount),invoice_payload:invoicePayload,telegram_payment_charge_id:tx.id};
     try{const r=premium.recordRefund(receiver.user.id,bot.botInfo.id,payment,tx.date*1000);if(!r.duplicate)summary.refunded++;}
     catch(error){summary.review++;premium.anomaly(receiver.user.id,payment,`refund:${error.message}`);}
    }
   }
   // Advance only after every fetched record has been applied or retained for review.
   // On interruption or error, the previous cursor is replayed without double credit.
   premium.db.prepare("INSERT INTO premium_sync_state(name,next_offset,checked_ms) VALUES('stars',?,?) ON CONFLICT(name) DO UPDATE SET next_offset=excluded.next_offset,checked_ms=excluded.checked_ms").run(batch.nextOffset,Date.now());
   return summary;
  })().finally(()=>{reconcilePromise=null;});
  return reconcilePromise;
 }
 bot.reconcilePremium=reconcile;
 bot.startPremiumReconciliation=()=>{
  if(reconcileTimer)return;
  const work=()=>void reconcile().catch(error=>console.error('Premium reconciliation failed',safeErrorSummary(error)));
  initialTimer=setTimeout(work,15000);initialTimer.unref?.();
  reconcileTimer=setInterval(work,5*60000);reconcileTimer.unref?.();
 };
 bot.stopPremium=async()=>{clearTimeout(initialTimer);clearInterval(reconcileTimer);reconcileTimer=null;if(reconcilePromise)await reconcilePromise.catch(()=>{});};
 return {showPremium,showVisibility};
}
