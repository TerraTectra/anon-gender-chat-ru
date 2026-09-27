import { randomUUID } from 'node:crypto';

export const TEST_PAYMENT_STARS = 8;
export const TEST_PAYMENT_TITLE = 'Тестовая оплата';
export const TEST_PAYMENT_DESCRIPTION = 'Тестовая оплата — 8 звёзд. Реальное разовое списание для проверки. Ничего не даёт: премиум, лимиты и функции не меняются. Без автопродления. Поддержка: /paysupport.';
export const TEST_PAYMENT_PREFIX = 'testpay:v1:';
const SCHEMA = `
CREATE TABLE IF NOT EXISTS test_payment_control (
 id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1))
);
INSERT OR IGNORE INTO test_payment_control(id,enabled) VALUES(1,0);
CREATE TABLE IF NOT EXISTS test_payment_orders (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, bot_id INTEGER NOT NULL,
 stars INTEGER NOT NULL CHECK(stars=8), created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL,
 checkout_id TEXT, approved_ms INTEGER, charge_id TEXT UNIQUE, paid_ms INTEGER, refunded_ms INTEGER,
 invoice_message_id INTEGER
);
CREATE INDEX IF NOT EXISTS test_payment_user_idx ON test_payment_orders(user_id,created_ms);
`;
const isTestPayload = value => typeof value === 'string' && value.startsWith(TEST_PAYMENT_PREFIX);
const validId = id => Number.isSafeInteger(id) && id > 0;

// Independent ledger: this module never writes premium_access, filtered_usage or user profiles.
export class TestPaymentStore {
  constructor(db) { this.db=db; db.exec(SCHEMA); }
  enabled() { return Boolean(this.db.prepare('SELECT enabled FROM test_payment_control WHERE id=1').get().enabled); }
  setEnabled(enabled) { this.db.prepare('UPDATE test_payment_control SET enabled=? WHERE id=1').run(enabled?1:0); }
  order(id) { return this.db.prepare('SELECT * FROM test_payment_orders WHERE id=?').get(id); }
  payload(order) { return TEST_PAYMENT_PREFIX+order.id; }
  paidByUser(userId) { return this.db.prepare('SELECT * FROM test_payment_orders WHERE user_id=? AND paid_ms IS NOT NULL LIMIT 1').get(userId); }
  create(userId,botId,now=Date.now()) {
    if(!this.enabled()||!validId(userId)||!validId(botId)) throw new Error('test_payment_disabled_or_invalid_user');
    if(this.paidByUser(userId)) throw new Error('test_already_paid');
    const pending=this.db.prepare('SELECT * FROM test_payment_orders WHERE user_id=? AND bot_id=? AND paid_ms IS NULL AND expires_ms>? ORDER BY created_ms DESC LIMIT 1').get(userId,botId,now);
    if(pending) return pending;
    const id=randomUUID();
    this.db.prepare('INSERT INTO test_payment_orders(id,user_id,bot_id,stars,created_ms,expires_ms) VALUES(?,?,?,?,?,?)').run(id,userId,botId,TEST_PAYMENT_STARS,now,now+24*60*60*1000);
    return this.order(id);
  }
  validate(userId,botId,payment) {
    const payload=String(payment.invoice_payload||'');
    if(!/^testpay:v1:[0-9a-f-]{36}$/.test(payload)) throw new Error('invalid_test_payload');
    const order=this.order(payload.slice(TEST_PAYMENT_PREFIX.length));
    if(!order||order.user_id!==userId||order.bot_id!==botId) throw new Error('foreign_test_order');
    if(payment.currency!=='XTR'||payment.total_amount!==TEST_PAYMENT_STARS||payment.total_amount!==order.stars) throw new Error('invalid_test_amount');
    return order;
  }
  approve(userId,botId,payment,now=Date.now()) {
    const order=this.validate(userId,botId,payment);
    if(!this.enabled()||order.expires_ms<=now||order.paid_ms!==null||order.refunded_ms!==null||this.paidByUser(userId)) throw new Error('test_payment_unavailable');
    if(typeof payment.id!=='string'||!payment.id||(order.checkout_id&&order.checkout_id!==payment.id)) throw new Error('test_checkout_already_started');
    this.db.prepare('UPDATE test_payment_orders SET checkout_id=?,approved_ms=? WHERE id=?').run(payment.id,now,order.id);
    return order;
  }
  recordPayment(userId,botId,payment,now=Date.now()) {
    const order=this.validate(userId,botId,payment),charge=payment.telegram_payment_charge_id;
    if(typeof charge!=='string'||!charge||charge.length>512) throw new Error('invalid_test_charge');
    if(order.charge_id&&order.charge_id!==charge) throw new Error('test_charge_mismatch');
    if(order.paid_ms!==null) return {duplicate:true,order};
    if(order.approved_ms===null) throw new Error('test_order_not_approved');
    this.db.prepare('UPDATE test_payment_orders SET charge_id=?,paid_ms=? WHERE id=? AND paid_ms IS NULL').run(charge,now,order.id);
    return {duplicate:false,order:this.order(order.id)};
  }
  recordRefund(userId,botId,payment,now=Date.now()) {
    const order=this.validate(userId,botId,payment),charge=payment.telegram_payment_charge_id;
    if(typeof charge!=='string'||!charge||charge.length>512||(order.charge_id&&order.charge_id!==charge)) throw new Error('test_refund_identity_mismatch');
    if(order.approved_ms===null) throw new Error('unapproved_test_refund');
    if(order.refunded_ms!==null) return {duplicate:true,order};
    this.db.prepare('UPDATE test_payment_orders SET charge_id=?,refunded_ms=? WHERE id=?').run(charge,now,order.id);
    return {duplicate:false,order:this.order(order.id)};
  }
  noteInvoice(orderId,messageId) { this.db.prepare('UPDATE test_payment_orders SET invoice_message_id=? WHERE id=?').run(messageId,orderId); }
}

export function testInvoiceParameters(ledger,order) {
  return {chat_id:order.user_id,title:TEST_PAYMENT_TITLE,description:TEST_PAYMENT_DESCRIPTION,payload:ledger.payload(order),provider_token:'',currency:'XTR',prices:[{label:TEST_PAYMENT_TITLE,amount:TEST_PAYMENT_STARS}],start_parameter:'test_payment'};
}

export function installTestPayment(bot,store,{adminIds=''}={}) {
  const ledger=new TestPaymentStore(store.db);
  const admins=new Set(String(adminIds).split(',').map(Number).filter(validId));
  const available=id=>admins.has(id)&&ledger.enabled()&&!ledger.paidByUser(id);
  bot.testPaymentAvailable=available;
  const confirmation='Тестовая оплата: получено 8 звёзд. Проверка прошла. Премиум, лимиты и функции не изменились.';
  async function notify(text) {
    if(bot.paymentAdminNotifier) await Promise.allSettled([...admins].map(id=>bot.paymentAdminNotifier(id,text)));
  }
  async function invoice(ctx) {
    if(ctx.chat?.type!=='private'||!admins.has(ctx.from.id)) return ctx.reply('Тестовая оплата недоступна.');
    if(!available(ctx.from.id)) return ctx.reply(ledger.paidByUser(ctx.from.id)?'Тестовая оплата уже получена. Повторное списание не требуется.':'Тестовая оплата отключена.');
    const order=ledger.create(ctx.from.id,ctx.me.id);
    const message=await ctx.api.raw.sendInvoice(testInvoiceParameters(ledger,order));
    ledger.noteInvoice(order.id,message.message_id);
  }
  // Route these BEFORE premium handlers. They must not grant premium or enter a conversation.
  bot.on('pre_checkout_query',async(ctx,next)=>{
    if(!isTestPayload(ctx.preCheckoutQuery.invoice_payload)) return next();
    let ok=true;
    try { if(!admins.has(ctx.from.id)) throw new Error('not_test_owner'); ledger.approve(ctx.from.id,ctx.me.id,ctx.preCheckoutQuery); }
    catch { ok=false; }
    await ctx.answerPreCheckoutQuery(ok,ok?{}:{error_message:'Тестовый счёт недоступен, уже использован или отключён. Новый счёт: /testpay.'});
  });
  bot.on('message:successful_payment',async(ctx,next)=>{
    const payment=ctx.message.successful_payment;
    if(!isTestPayload(payment.invoice_payload)) return next();
    let result;
    try { result=ledger.recordPayment(ctx.from.id,ctx.me.id,payment); }
    catch(error) {
      store.premium.anomaly(ctx.from.id,payment,'test:'+error.message);
      await Promise.allSettled([ctx.reply('Тестовый платёж получен, но требует проверки. Доступ не менялся. Поддержка: /paysupport.'),notify('Тестовый платёж требует проверки. Платёжные данные сохранены.')]);
      return;
    }
    if(!result.duplicate&&result.order.refunded_ms===null) await Promise.allSettled([ctx.reply(confirmation),notify(confirmation)]);
  });
  bot.on('message:refunded_payment',async(ctx,next)=>{
    const payment=ctx.message.refunded_payment;
    if(!isTestPayload(payment.invoice_payload)) return next();
    try { ledger.recordRefund(ctx.chat.id,ctx.me.id,payment); }
    catch(error) { store.premium.anomaly(ctx.chat.id,payment,'test_refund:'+error.message); }
  });
  bot.command('testpay',invoice);
  bot.callbackQuery('testpay:create',async ctx=>{await ctx.answerCallbackQuery();await invoice(ctx);});
  bot.command('start',async(ctx,next)=>ctx.match==='test_payment'?invoice(ctx):next());
  bot.reconcileTestTransaction=async tx=>{
    const partner=tx.source||tx.receiver;
    if(partner?.type!=='user'||partner.transaction_type!=='invoice_payment') return false;
    const known=ledger.db.prepare('SELECT * FROM test_payment_orders WHERE charge_id=? AND user_id=?').get(tx.id,partner.user.id);
    const payload=partner.invoice_payload||(known?ledger.payload(known):null);
    if(!isTestPayload(payload)) return false;
    const payment={currency:'XTR',total_amount:Math.abs(tx.amount),invoice_payload:payload,telegram_payment_charge_id:tx.id};
    try {
      if(tx.source) { const result=ledger.recordPayment(partner.user.id,bot.botInfo.id,payment,tx.date*1000);if(!result.duplicate&&result.order.refunded_ms===null) await bot.api.sendMessage(partner.user.id,confirmation).catch(()=>{}); }
      else ledger.recordRefund(partner.user.id,bot.botInfo.id,payment,tx.date*1000);
    } catch(error) { store.premium.anomaly(partner.user.id,payment,'test_reconcile:'+error.message); }
    return true;
  };
  return ledger;
}
