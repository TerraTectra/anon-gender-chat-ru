import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { createAdminBot } from '../src/admin-bot.js';

async function fixture(run){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'payment-panel-')),file=path.join(dir,'chat.db');
 const store=new Store(file);store.upsertUser(1,'buyer');store.setProfile(1,{age:25,gender:'male'});
 const order=store.premium.createOrder(1,123456,'week');store.premium.acceptOrder(1,123456,order.id);
 const p={id:'checkout',currency:'XTR',total_amount:25,invoice_payload:store.premium.payload(order),telegram_payment_charge_id:'charge-panel'};
 store.premium.approve(1,123456,p);store.premium.applyPayment(1,123456,p);
 store.db.exec(`CREATE TABLE IF NOT EXISTS test_payment_orders(id TEXT PRIMARY KEY,user_id INTEGER,bot_id INTEGER,stars INTEGER,created_ms INTEGER,expires_ms INTEGER,checkout_id TEXT,approved_ms INTEGER,charge_id TEXT,paid_ms INTEGER,refunded_ms INTEGER,invoice_message_id INTEGER);`);
 store.db.prepare('INSERT OR IGNORE INTO test_payment_orders(id,user_id,bot_id,stars,created_ms,expires_ms,charge_id,paid_ms,refunded_ms) VALUES(?,?,?,?,?,?,?,?,?)').run('11111111-1111-4111-8111-111111111111',1,123456,8,1,2,'old-test-charge',3,4);
 const sent=[],refunds=[];let failRefund=false,balance={amount:0};
 const bot=createAdminBot('654321:offline-test',file,'9',{
   sourcePaymentBalance:async()=>balance,
   sourcePaymentBotId:async()=>123456,
   sourcePaymentRefund:async(...args)=>{refunds.push(args);if(failRefund)throw new Error('network down');return true;},
   sourcePaymentMessage:async()=>true,
   sourcePaymentReconcile:async()=>({restored:0,refunded:0,review:0,complete:true})
 });
 bot.botInfo={id:654321,is_bot:true,first_name:'Admin',username:'AdminTestBot'};
 bot.api.config.use(async(_previous,method,payload)=>{sent.push({method,...payload});return {ok:true,result:{message_id:1,date:1,chat:{id:payload.chat_id,type:'private'},text:payload.text}};});
 let seq=1;
 const send=(id,text,type='private')=>bot.handleUpdate({update_id:seq++,message:{message_id:seq,date:1,from:{id,is_bot:false,first_name:'Test'},chat:{id:type==='private'?id:-99,type},text,entities:[{type:'bot_command',offset:0,length:text.split(' ')[0].length}]}});
 const callback=(id,data,type='private')=>bot.handleUpdate({update_id:seq++,callback_query:{id:String(seq),from:{id,is_bot:false,first_name:'Test'},chat_instance:'test',data,message:{message_id:1,date:1,chat:{id:type==='private'?id:-99,type},text:'confirm'}}});
 try{await run({store,order,sent,refunds,send,callback,setFail:v=>{failRefund=v;},setBalance:v=>{balance=v;}});}
 finally{bot.stopDailyReportScheduler();bot.closeStore();store.close();fs.rmSync(dir,{recursive:true,force:true});}
}

test('payments and balance ignore historical test-payment audit rows',()=>fixture(async({send,sent,setBalance})=>{
 setBalance({amount:8});await send(9,'/payments');
 const text=sent.at(-1).text;assert.match(text,/Баланс основного бота: 8/);assert.ok(!text.includes('Тестовая оплата'));assert.ok(!text.includes('Тестовых оплат'));
 const buttons=sent.at(-1).reply_markup.inline_keyboard.flat();assert.ok(buttons.some(x=>x.text?.includes('Премиум 7 дн.')));assert.ok(buttons.some(x=>x.callback_data?.startsWith('payment:p:')));assert.ok(!buttons.some(x=>x.callback_data?.includes(':t:')));
}));

test('premium refund requires two explicit admin actions',()=>fixture(async({store,order,send,callback,refunds})=>{
 await send(9,'/refund '+order.id);assert.equal(refunds.length,0);assert.equal(store.premium.active(1),true);
 await callback(9,'payrefund:'+order.id);assert.deepEqual(refunds,[[1,'charge-panel']]);assert.equal(store.premium.active(1),false);
 await callback(9,'payrefund:'+order.id);assert.equal(refunds.length,1);
}));

test('payment detail exposes refund button without executing it',()=>fixture(async({order,callback,sent,refunds})=>{
 await callback(9,'payment:p:'+order.id);assert.equal(refunds.length,0);
 const buttons=sent.at(-1).reply_markup.inline_keyboard.flat();assert.ok(buttons.some(x=>x.callback_data==='refundask:p:'+order.id));
}));

test('failed refund preserves premium and reports failure',()=>fixture(async({store,order,send,callback,setFail,sent})=>{
 setFail(true);await send(9,'/refund '+order.id);await callback(9,'payrefund:'+order.id);
 assert.equal(store.premium.active(1),true);assert.ok(sent.some(x=>x.text?.includes('не подтвердил результат')));
}));

test('non-admin cannot read balance or issue refunds',()=>fixture(async({order,send,callback,refunds})=>{
 await send(1,'/balance');await callback(1,'payment:p:'+order.id);await callback(1,'refundask:p:'+order.id);await callback(1,'payrefund:'+order.id);
 assert.equal(refunds.length,0);
}));

test('payment administration is private-chat only',()=>fixture(async({order,send,callback,refunds,sent})=>{
 await send(9,'/payments','group');await callback(9,'refundask:p:'+order.id,'group');assert.equal(refunds.length,0);assert.ok(sent.some(x=>x.text?.includes('только в личном')));
}));

test('balance failure never masquerades as zero',()=>fixture(async({send,sent,setBalance})=>{
 setBalance(null);await send(9,'/payments');assert.match(sent.at(-1).text,/НЕ считается нулевым/);
}));
