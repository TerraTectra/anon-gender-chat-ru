import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { createUserBot } from '../src/user-bot.js';
import { createAdminBot } from '../src/admin-bot.js';
import { paymentConfiguration,variantSalesEnabled,EXPERIMENT_VERSION } from '../src/premium-pricing.js';
import { premiumTerms,invoiceParameters } from '../src/premium-bot.js';
import { premiumMetrics } from '../src/network-payment-admin.js';
import { DAY_MS } from '../src/premium-store.js';

const from=id=>({id,is_bot:false,first_name:'Offline'});
async function fixture(run,{brand='english',enabled=true,age=25}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'stars-brands-')),file=path.join(root,'chat.db');
 const config=paymentConfiguration(brand),store=new Store(file,{premiumOptions:config});
 const bot=createUserBot('123456:offline',file,{store,isVariant:true,salesEnabled:enabled,brandId:brand,brandName:brand,paymentConfig:config});
 bot.botInfo={id:123456,is_bot:true,first_name:'Offline',username:'OfflineTestBot'};
 store.upsertUser(1,'offline');store.setProfile(1,{age,gender:'male'});
 const sent=[];let n=1,ledger=[];
 bot.api.config.use(async(_previous,method,payload)=>{
  sent.push({method,...payload});
  return {ok:true,result:method==='getStarTransactions'?{transactions:ledger.slice(payload.offset,payload.offset+payload.limit)}:{message_id:n,date:1,chat:{id:payload.chat_id,type:'private'},text:payload.text}};
 });
 const cb=data=>bot.handleUpdate({update_id:n++,callback_query:{id:String(n),from:from(1),chat_instance:'test',data,message:{message_id:1,date:1,chat:{id:1,type:'private'},text:'offline'}}});
 const send=text=>bot.handleUpdate({update_id:n++,message:{message_id:n,date:1,from:from(1),chat:{id:1,type:'private'},text,entities:[{type:'bot_command',offset:0,length:text.split(' ')[0].length}]}});
 const checkout=p=>bot.handleUpdate({update_id:n++,pre_checkout_query:{...p,from:from(1)}});
 const paid=p=>bot.handleUpdate({update_id:n++,message:{message_id:n,date:1,from:from(1),chat:{id:1,type:'private'},successful_payment:p}});
 const order=(plan='week',now=Date.now())=>{
  const o=store.premium.createOrder(1,123456,plan,now,age);
  store.premium.acceptOrder(1,123456,o.id,now,true);
  return {o,p:{id:'checkout-'+o.id,currency:'XTR',total_amount:o.stars,invoice_payload:store.premium.payload(o),telegram_payment_charge_id:'charge-'+o.id}};
 };
 try{await run({root,file,bot,store,sent,cb,send,checkout,paid,order,setLedger:value=>{ledger=value;}});}
 finally{bot.stopSessionRetention();await bot.stopPremium();await bot.drainArchiveJobs();store.close();fs.rmSync(root,{recursive:true,force:true});}
}

test('eight static brand schedules span 1 to 18000 Stars; main prices stay unchanged',()=>{
 const ids=['english','focus','game','budget','hub','task','quiz','party'];
 assert.deepEqual(Object.values(paymentConfiguration('anon').plans).map(p=>p.stars),[25,75,180]);
 assert.equal(new Set(ids.map(id=>JSON.stringify(paymentConfiguration(id).plans))).size,8);
 for(const id of ids){const c=paymentConfiguration(id);assert.equal(c.adultOnly,true);assert.equal(c.termsVersion,EXPERIMENT_VERSION);assert.ok(Object.values(c.plans).every(p=>Number.isSafeInteger(p.stars)&&p.stars>=1&&p.stars<=18000));}
 assert.equal(paymentConfiguration('english').plans.week.stars,1);
 assert.equal(paymentConfiguration('party').plans.quarter.stars,18000);
 assert.throws(()=>paymentConfiguration('missing'));
 assert.equal(variantSalesEnabled('english','english,focus'),true);
 assert.equal(variantSalesEnabled('party','english,focus'),false);
 assert.equal(variantSalesEnabled('party','all'),true);
 assert.equal(variantSalesEnabled('party',''),false);
});

test('each brand menu, terms, invoice and paid receipt use its own Stars price',async()=>{
 for(const brand of ['english','focus','game','budget','hub','task','quiz','party'])await fixture(async({store,sent,cb,send,checkout,paid})=>{
  const stars=paymentConfiguration(brand).plans.week.stars;
  await send('/premium');await cb('premium:plan:week');
  const o=store.db.prepare('SELECT * FROM premium_orders').get();
  assert.equal(o.stars,stars);assert.equal(o.brand_id,brand);assert.equal(o.accepted_ms,null);
  assert.equal(sent.filter(x=>x.method==='sendInvoice').length,0);
  assert.ok(sent.some(x=>x.text?.includes(`7 дней — ${stars} Stars`)));
  if(stars>=750)assert.ok(sent.some(x=>x.text?.includes('высокая стоимость')));
  await cb('premium:accept:'+o.id);await cb('premium:accept:'+o.id);
  const invoices=sent.filter(x=>x.method==='sendInvoice');assert.equal(invoices.length,1);
  const invoice=invoices[0];assert.equal(invoice.currency,'XTR');assert.equal(invoice.provider_token,'');assert.equal(invoice.prices[0].amount,stars);assert.equal(invoice.start_parameter,'premium');
  assert.equal(store.premium.order(o.id).consent_age,25);assert.ok(store.premium.order(o.id).adult_confirmed_ms);
  const p={id:'checkout',currency:'XTR',total_amount:stars,invoice_payload:invoice.payload,telegram_payment_charge_id:'charge'};
  await checkout(p);assert.equal(store.premium.active(1),false);await paid(p);await paid(p);
  assert.equal(store.premium.recentPayments().length,1);assert.equal(store.premium.active(1),true);
  const m=premiumMetrics(store.premium);assert.equal(m.buyers,1);assert.equal(m.gross,stars);assert.equal(m.views,1);assert.equal(m.accepted,1);
 },{brand});
});

test('minor cannot create, accept or check out an experiment order; support remains available',()=>fixture(async({store,sent,cb,send,checkout})=>{
 await cb('premium:plan:week');assert.equal(store.db.prepare('SELECT COUNT(*) n FROM premium_orders').get().n,0);
 assert.ok(sent.some(x=>x.text?.includes('с 18 лет')));
 assert.throws(()=>store.premium.createOrder(1,123456,'week',Date.now(),17),/adults_only/);
 const o=store.premium.createOrder(1,123456,'week',Date.now(),25);
 await cb('premium:accept:'+o.id);assert.ok(!sent.some(x=>x.method==='sendInvoice'));
 store.premium.acceptOrder(1,123456,o.id,Date.now(),true);
 await checkout({id:'minor',currency:'XTR',total_amount:o.stars,invoice_payload:store.premium.payload(o)});
 assert.equal(sent.find(x=>x.method==='answerPreCheckoutQuery').ok,false);
 await send('/paysupport Возврат');assert.equal(store.premium.openSupport().length,1);
},{age:17}));

test('a paused sales stage rejects existing consent buttons and checkout but processes receipts',()=>fixture(async({store,sent,cb,checkout,paid,order})=>{
 const {o,p}=order();await cb('premium:accept:'+o.id);assert.ok(!sent.some(x=>x.method==='sendInvoice'));
 await checkout(p);assert.equal(sent.find(x=>x.method==='answerPreCheckoutQuery').ok,false);
 store.premium.approve(1,123456,p);await paid(p);assert.equal(store.premium.recentPayments().length,1);
},{enabled:false}));

test('order keeps its quoted amount across pricing changes and database reopening',()=>fixture(async({store,order,file})=>{
 const {o,p}=order();store.premium.configure({...paymentConfiguration('english'),plans:{week:{days:7,stars:99}}});
 assert.equal(invoiceParameters(store.premium,store.premium.order(o.id),1).prices[0].amount,1);
 store.premium.approve(1,123456,p);
 const reopened=new Store(file,{premiumOptions:paymentConfiguration('english')});
 try{assert.equal(reopened.premium.applyPayment(1,123456,p).order.stars,1);assert.equal(reopened.premium.recentPayments().length,1);}
 finally{reopened.close();}
}));

test('new order cancels an older pending invoice; cancel invalidates consent',()=>fixture(async({store,cb,sent})=>{
 const old=store.premium.createOrder(1,123456,'week',Date.now(),25);
 const next=store.premium.createOrder(1,123456,'month',Date.now(),25);
 await cb('premium:accept:'+old.id);assert.ok(!sent.some(x=>x.method==='sendInvoice'));
 await cb('premium:cancel:'+next.id);await cb('premium:accept:'+next.id);
 assert.ok(!sent.some(x=>x.method==='sendInvoice'));
}));

test('checkout reservation, rolling gross spend cap and prepaid cap prevent excess purchases',()=>fixture(async({store,order})=>{
 const now=Date.now(),{o,p}=order('quarter',now);assert.equal(o.stars,18000);
 store.premium.approve(1,123456,p,now);
 assert.throws(()=>store.premium.createOrder(1,123456,'week',now,25),/daily_spend_limit|checkout_in_progress/);
 store.premium.applyPayment(1,123456,p,now);store.premium.refund(p.telegram_payment_charge_id,1,now+1);
 assert.throws(()=>store.premium.createOrder(1,123456,'week',now+2,25),/daily_spend_limit/);
 assert.doesNotThrow(()=>store.premium.createOrder(1,123456,'week',now+DAY_MS+1,25));
 store.db.prepare('INSERT INTO premium_access VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET until_ms=excluded.until_ms').run(1,now+365*DAY_MS);
 assert.throws(()=>store.premium.createOrder(1,123456,'week',now+DAY_MS+2,25),/prepaid_limit/);
},{brand:'party'}));

test('late ledger restoration uses original payment time, refunds remain idempotent',()=>fixture(async({store,order,bot,setLedger})=>{
 const now=Date.now(),{o,p}=order('week',now-2*DAY_MS);store.premium.approve(1,123456,p,now-2*DAY_MS);
 const date=Math.floor((now-2*DAY_MS)/1000);
 setLedger([{id:p.telegram_payment_charge_id,date,amount:o.stars,source:{type:'user',transaction_type:'invoice_payment',user:{id:1},invoice_payload:p.invoice_payload}}]);
 assert.equal((await bot.reconcilePremium()).restored,1);assert.equal(store.premium.until(1),date*1000+7*DAY_MS);
 await bot.reconcilePremium();assert.equal(store.premium.recentPayments().length,1);
 setLedger([{id:p.telegram_payment_charge_id,date:Math.floor(now/1000),amount:-o.stars,receiver:{type:'user',transaction_type:'invoice_payment',user:{id:1}}}]);
 assert.equal((await bot.reconcilePremium()).refunded,1);assert.equal((await bot.reconcilePremium()).refunded,0);
 assert.equal(store.premium.active(1),false);
}));

test('a refund payload cannot revoke a different order with the same buyer',()=>fixture(async({store,order})=>{
 const {p}=order();store.premium.approve(1,123456,p);store.premium.applyPayment(1,123456,p);
 const another=order('week');
 assert.throws(()=>store.premium.recordRefund(1,123456,{...p,invoice_payload:another.p.invoice_payload}),/refund_order_mismatch/);
 assert.equal(store.premium.active(1),true);
}));

test('restoring an expired old purchase never extends a separate recent purchase across a gap',()=>fixture(async({store,order,bot,setLedger})=>{
 const now=Date.now(),old=order('week',now-30*DAY_MS);
 store.premium.approve(1,123456,old.p,now-30*DAY_MS);
 const recent=order('week',now);store.premium.approve(1,123456,recent.p,now);
 store.premium.applyPayment(1,123456,recent.p,now);
 const expected=store.premium.until(1);
 setLedger([{id:old.p.telegram_payment_charge_id,date:Math.floor((now-30*DAY_MS)/1000),amount:old.o.stars,source:{type:'user',transaction_type:'invoice_payment',user:{id:1},invoice_payload:old.p.invoice_payload}}]);
 assert.equal((await bot.reconcilePremium()).restored,1);
 assert.equal(store.premium.until(1),expected);
 assert.equal(store.premium.recentPayments().length,2);
 store.premium.refund(recent.p.telegram_payment_charge_id,1,now+1000);
 assert.equal(store.premium.active(1),false);
}));

test('experiment terms fit Telegram, disclose caps, scope and adult-only sales',()=>fixture(async({store})=>{
 const text=premiumTerms(store.premium,{adultOnly:true,brandName:'Искра'});
 assert.ok(text.length<3500);assert.match(text,/только с 18/);assert.match(text,/18 000/);assert.match(text,/365/);assert.match(text,/только в этом боте/);
 assert.ok(!text.includes('7 дней — 25 Stars'));
}));

test('network admin authorizes before routing, scopes refunds and support to their actual bot',async()=>{
 const prior=process.cwd(),root=fs.mkdtempSync(path.join(os.tmpdir(),'stars-network-admin-'));
 let admin,english,main;
 try{
  process.chdir(root);main=new Store('main.db');english=new Store('./data/anon-variants/english.db',{premiumOptions:paymentConfiguration('english')});
  english.upsertUser(1,'offline');english.setProfile(1,{age:25,gender:'male'});
  const o=english.premium.createOrder(1,123456,'week',Date.now(),25);english.premium.acceptOrder(1,123456,o.id,Date.now(),true);
  const p={id:'checkout',currency:'XTR',total_amount:1,invoice_payload:english.premium.payload(o),telegram_payment_charge_id:'scoped-charge'};
  english.premium.approve(1,123456,p);english.premium.applyPayment(1,123456,p);
  const ticket=english.premium.addSupport(1,'Help');const actions=[],sent=[];let n=1;
  admin=createAdminBot('654321:offline','main.db','9',{anonVariantsEnabled:true,networkPaymentAction:async(id,action,...args)=>{
   actions.push({id,action,args});if(action==='botId')return 123456;if(action==='balance')return {amount:7};if(action==='reconcile')return {restored:0,refunded:0,review:0,complete:true};return true;
  }});
  admin.botInfo={id:654321,is_bot:true,first_name:'Offline',username:'AdminOfflineBot'};
  admin.api.config.use(async(_prev,method,payload)=>{sent.push({method,...payload});return {ok:true,result:{message_id:1,date:1,chat:{id:payload.chat_id,type:'private'},text:payload.text}};});
  const send=(id,text,type='private')=>admin.handleUpdate({update_id:n++,message:{message_id:n,date:1,from:from(id),chat:{id:type==='private'?id:-99,type},text,entities:[{type:'bot_command',offset:0,length:text.split(' ')[0].length}]}});
  const cb=(id,data)=>admin.handleUpdate({update_id:n++,callback_query:{id:String(n),from:from(id),chat_instance:'test',data,message:{message_id:1,date:1,chat:{id,type:'private'},text:'offline'}}});
  await send(1,'/payments');await cb(1,'np:english:payrefund:'+o.id);assert.equal(actions.length,0);
  await send(9,'/payments','group');assert.equal(actions.length,0);
  await send(9,'/payments');assert.ok(sent.some(x=>x.text?.includes('Баланс сети Telegram Stars')));assert.ok(sent.some(x=>x.text?.includes('63 ⭐')));await cb(9,'payments:network_breakdown');assert.ok(sent.some(x=>x.text?.includes('Платежи по ботам')));await cb(9,'payments:network_manage');assert.ok(sent.some(x=>x.text?.includes('Выберите бота для просмотра платежей')));
  await cb(9,'np:english:payments:home');assert.ok(actions.some(x=>x.id==='english'&&x.action==='balance'));
  await cb(9,'np:english:payment:p:'+o.id);await cb(9,'np:focus:payment:p:'+o.id);
  assert.ok(sent.some(x=>x.text?.includes('не найден')));
  await cb(9,'np:english:payrefund:'+o.id);assert.ok(!actions.some(x=>x.action==='refund'));
  await cb(9,'np:english:refundask:p:'+o.id);await cb(8,'np:english:payrefund:'+o.id);assert.ok(!actions.some(x=>x.action==='refund'));
  await cb(9,'np:english:payrefund:'+o.id);await cb(9,'np:english:payrefund:'+o.id);
  assert.deepEqual(actions.filter(x=>x.action==='refund'),[{id:'english',action:'refund',args:[1,'scoped-charge']}]);
  assert.equal(english.premium.active(1),false);assert.equal(main.premium.recentPayments().length,0);
  await send(9,`/payreply_chat english ${ticket.id} Проверяем`);assert.ok(actions.some(x=>x.id==='english'&&x.action==='message'&&x.args[1].includes('Проверяем')));
  await send(9,`/payclose_chat english ${ticket.id}`);assert.equal(english.premium.openSupport().length,0);
  await cb(9,'np:english:payments:reconcile');assert.ok(actions.some(x=>x.id==='english'&&x.action==='reconcile'));
  for(const item of sent)for(const row of item.reply_markup?.inline_keyboard||[])for(const button of row)if(button.callback_data)assert.ok(Buffer.byteLength(button.callback_data)<=64,button.callback_data);
 }finally{admin?.stopDailyReportScheduler();admin?.closeStore();english?.close();main?.close();process.chdir(prior);fs.rmSync(root,{recursive:true,force:true});}
});
