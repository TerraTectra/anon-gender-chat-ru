import { randomUUID } from 'node:crypto';
export const DAY_MS=86400000;
export const TERMS_VERSION='2026-09-27-v1';
export const PLANS=Object.freeze({week:{days:7,stars:25,label:'7 дней'},month:{days:30,stars:75,label:'30 дней'},quarter:{days:90,stars:180,label:'90 дней'}});
const SCHEMA=`
CREATE TABLE IF NOT EXISTS premium_orders(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,bot_id INTEGER NOT NULL,plan TEXT NOT NULL,days INTEGER NOT NULL,stars INTEGER NOT NULL,terms TEXT NOT NULL,created_ms INTEGER NOT NULL,expires_ms INTEGER NOT NULL,accepted_ms INTEGER,checkout_id TEXT,state TEXT NOT NULL DEFAULT 'pending');
CREATE TABLE IF NOT EXISTS premium_payments(charge_id TEXT PRIMARY KEY,order_id TEXT NOT NULL UNIQUE REFERENCES premium_orders(id),user_id INTEGER NOT NULL,paid_ms INTEGER NOT NULL,days INTEGER NOT NULL,stars INTEGER NOT NULL,refunded_ms INTEGER);
CREATE INDEX IF NOT EXISTS premium_user_idx ON premium_payments(user_id,paid_ms);
CREATE INDEX IF NOT EXISTS premium_orders_user_created ON premium_orders(user_id,created_ms);
CREATE TABLE IF NOT EXISTS premium_refunds(charge_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,refunded_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS premium_access(user_id INTEGER PRIMARY KEY,until_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS profile_visibility(user_id INTEGER PRIMARY KEY,visible INTEGER NOT NULL,decided_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payment_support(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,text TEXT NOT NULL,created_ms INTEGER NOT NULL,resolved_ms INTEGER);
CREATE TABLE IF NOT EXISTS payment_anomalies(charge_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,payment_json TEXT NOT NULL,reason TEXT NOT NULL,created_ms INTEGER NOT NULL);
`;
export class PremiumStore {
 constructor(db){this.db=db;db.exec(SCHEMA);}
 until(id){return Number(this.db.prepare('SELECT until_ms FROM premium_access WHERE user_id=?').get(id)?.until_ms||0);}
 active(id,now=Date.now()){return this.until(id)>now;}
 visibility(id){const r=this.db.prepare('SELECT visible FROM profile_visibility WHERE user_id=?').get(id);return r?Boolean(r.visible):null;}
 setVisibility(id,visible,now=Date.now()){this.db.prepare('INSERT INTO profile_visibility VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET visible=excluded.visible,decided_ms=excluded.decided_ms').run(id,visible?1:0,now);}
 order(id){return this.db.prepare('SELECT * FROM premium_orders WHERE id=?').get(id);}
 createOrder(userId,botId,plan,now=Date.now()){
  if(!Number.isSafeInteger(userId)||userId<=0||!Number.isSafeInteger(botId)||botId<=0||!Object.hasOwn(PLANS,plan))throw new Error('invalid_order');
  const id=randomUUID(),p=PLANS[plan];
  this.db.prepare('INSERT INTO premium_orders(id,user_id,bot_id,plan,days,stars,terms,created_ms,expires_ms) VALUES(?,?,?,?,?,?,?,?,?)').run(id,userId,botId,plan,p.days,p.stars,TERMS_VERSION,now,now+900000);
  return this.order(id);
 }
 acceptOrder(userId,botId,id,now=Date.now()){
  const o=this.order(id);
  if(!o||o.user_id!==userId||o.bot_id!==botId||o.expires_ms<=now||o.state!=='pending')throw new Error('order_unavailable');
  this.db.prepare('UPDATE premium_orders SET accepted_ms=? WHERE id=?').run(now,id);return this.order(id);
 }
 payload(order){return `premium:v1:${order.id}`;}
 validate(userId,botId,payment,checkout=false,now=Date.now()){
  const payload=String(payment.invoice_payload||'');
  if(!/^premium:v1:[0-9a-f-]{36}$/.test(payload))throw new Error('invalid_payload');
  const order=this.order(payload.slice(11));
  if(!order||order.user_id!==userId||order.bot_id!==botId)throw new Error('foreign_order');
  if(payment.currency!=='XTR'||payment.total_amount!==order.stars)throw new Error('wrong_amount');
  if(checkout&&(order.accepted_ms==null||order.expires_ms<=now||!['pending','approved'].includes(order.state)))throw new Error('expired_or_paid');
  return order;
 }
 approve(userId,botId,payment,now=Date.now()){
  const o=this.validate(userId,botId,payment,true,now);
  if(typeof payment.id!=='string'||!payment.id)throw new Error('missing_checkout_id');
  if(o.checkout_id&&o.checkout_id!==payment.id)throw new Error('checkout_already_started');
  this.db.prepare("UPDATE premium_orders SET state='approved',checkout_id=? WHERE id=?").run(payment.id,o.id);return this.order(o.id);
 }
 applyPayment(userId,botId,payment,now=Date.now()){
  const order=this.validate(userId,botId,payment),charge=payment.telegram_payment_charge_id;
  if(typeof charge!=='string'||!charge||charge.length>512)throw new Error('invalid_charge');
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const old=this.db.prepare('SELECT * FROM premium_payments WHERE charge_id=?').get(charge);
   if(old){if(old.user_id!==userId||old.order_id!==order.id)throw new Error('charge_mismatch');this.db.exec('COMMIT');return {duplicate:true,refunded:Boolean(old.refunded_ms),until:this.until(userId),order};}
   if(order.state!=='approved')throw new Error('unapproved_order');
   this.db.prepare('INSERT INTO premium_payments(charge_id,order_id,user_id,paid_ms,days,stars) VALUES(?,?,?,?,?,?)').run(charge,order.id,userId,now,order.days,order.stars);
   const refunded=this.db.prepare('SELECT * FROM premium_refunds WHERE charge_id=? AND user_id=?').get(charge,userId);
   if(refunded){
    this.db.prepare('UPDATE premium_payments SET refunded_ms=? WHERE charge_id=?').run(refunded.refunded_ms,charge);
    this.db.prepare("UPDATE premium_orders SET state='refunded' WHERE id=?").run(order.id);
    this.db.exec('COMMIT');return {duplicate:false,refunded:true,until:this.until(userId),order};
   }
   this.db.prepare("UPDATE premium_orders SET state='paid' WHERE id=?").run(order.id);
   const until=Math.max(now,this.until(userId))+order.days*DAY_MS;
   this.db.prepare('INSERT INTO premium_access VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET until_ms=excluded.until_ms').run(userId,until);
   this.db.exec('COMMIT');return {duplicate:false,refunded:false,until,order};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 anomaly(userId,payment,reason,now=Date.now()){this.db.prepare('INSERT OR IGNORE INTO payment_anomalies VALUES(?,?,?,?,?)').run(String(payment.telegram_payment_charge_id||randomUUID()),userId,JSON.stringify(payment),String(reason).slice(0,200),now);}
 paymentForOrder(id){return this.db.prepare('SELECT p.*,o.bot_id FROM premium_payments p JOIN premium_orders o ON o.id=p.order_id WHERE order_id=?').get(id);}
 recentPayments(){return this.db.prepare('SELECT * FROM premium_payments ORDER BY paid_ms DESC LIMIT 10').all();}
 recordRefund(userId,botId,payment,now=Date.now()){
  this.validate(userId,botId,payment);
  const charge=payment.telegram_payment_charge_id;
  if(typeof charge!=='string'||!charge||charge.length>512)throw new Error('invalid_charge');
  const previous=this.db.prepare('SELECT * FROM premium_refunds WHERE charge_id=?').get(charge);
  if(previous&&previous.user_id!==userId)throw new Error('refund_identity_mismatch');
  this.db.prepare('INSERT OR IGNORE INTO premium_refunds VALUES(?,?,?)').run(charge,userId,now);
  const p=this.db.prepare('SELECT * FROM premium_payments WHERE charge_id=?').get(charge);
  if(p)return this.refund(charge,userId,now);
  return {pending:true,until:this.until(userId)};
 }
 refund(chargeId,userId,now=Date.now()){
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const p=this.db.prepare('SELECT * FROM premium_payments WHERE charge_id=? AND user_id=?').get(chargeId,userId);
   if(!p)throw new Error('unknown_payment');
   if(!p.refunded_ms){
    this.db.prepare('UPDATE premium_payments SET refunded_ms=? WHERE charge_id=?').run(now,chargeId);
    this.db.prepare("UPDATE premium_orders SET state='refunded' WHERE id=?").run(p.order_id);
    let until=0;
    for(const row of this.db.prepare('SELECT * FROM premium_payments WHERE user_id=? AND refunded_ms IS NULL ORDER BY paid_ms,rowid').all(userId))until=Math.max(until,row.paid_ms)+row.days*DAY_MS;
    this.db.prepare('INSERT INTO premium_access VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET until_ms=excluded.until_ms').run(userId,until);
   }
   this.db.exec('COMMIT');return {duplicate:Boolean(p.refunded_ms),until:this.until(userId)};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 addSupport(id,text,now=Date.now()){
  const old=this.db.prepare('SELECT id FROM payment_support WHERE user_id=? AND created_ms>? ORDER BY id DESC LIMIT 1').get(id,now-60000);
  if(old)return {id:old.id,limited:true};
  const r=this.db.prepare('INSERT INTO payment_support(user_id,text,created_ms) VALUES(?,?,?)').run(id,String(text).slice(0,2000),now);return {id:Number(r.lastInsertRowid),limited:false};
 }
 openSupport(){return this.db.prepare('SELECT * FROM payment_support WHERE resolved_ms IS NULL ORDER BY id DESC LIMIT 10').all();}
}
