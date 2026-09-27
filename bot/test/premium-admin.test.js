import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { createAdminBot } from '../src/admin-bot.js';

async function fixture(run){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'premium-admin-')),file=path.join(dir,'chat.db');
 const store=new Store(file);store.upsertUser(1,'test');store.setProfile(1,{age:25,gender:'male'});
 const order=store.premium.createOrder(1,123456,'week');store.premium.acceptOrder(1,123456,order.id);
 const p={id:'checkout',currency:'XTR',total_amount:25,invoice_payload:store.premium.payload(order),telegram_payment_charge_id:'charge-admin-test'};
 store.premium.approve(1,123456,p);store.premium.applyPayment(1,123456,p);
 const sent=[],refunds=[],replies=[];let failRefund=false;
 const bot=createAdminBot('654321:offline-test',file,'9',{sourcePaymentRefund:async(...args)=>{refunds.push(args);if(failRefund)throw new Error('network down');return true;},sourcePaymentMessage:async(...args)=>{replies.push(args);return true;},sourcePaymentReconcile:async()=>({restored:0,refunded:0,review:0})});
 bot.botInfo={id:654321,is_bot:true,first_name:'Admin',username:'PremiumAdminTestBot'};
 bot.api.config.use(async(_previous,method,payload)=>{sent.push({method,...payload});return {ok:true,result:{message_id:1,date:1,chat:{id:payload.chat_id,type:'private'},text:payload.text}};});
 let seq=1;
 const send=(id,text,type='private')=>bot.handleUpdate({update_id:seq++,message:{message_id:seq,date:1,from:{id,is_bot:false,first_name:'Test'},chat:{id:type==='private'?id:-99,type},text,entities:[{type:'bot_command',offset:0,length:text.split(' ')[0].length}]}});
 const callback=(id,data)=>bot.handleUpdate({update_id:seq++,callback_query:{id:String(seq),from:{id,is_bot:false,first_name:'Test'},chat_instance:'test',data,message:{message_id:1,date:1,chat:{id,type:'private'},text:'confirm'}}});
 try{await run({store,order,p,sent,refunds,replies,send,callback,setFail:value=>{failRefund=value;}});}
 finally{bot.stopDailyReportScheduler();bot.closeStore();store.close();fs.rmSync(dir,{recursive:true,force:true});}
}
test('non-admin cannot list payments or issue refunds',()=>fixture(async({send,callback,refunds,sent,order})=>{await send(1,'/payments');await callback(1,'payrefund:'+order.id);assert.equal(refunds.length,0);assert.ok(sent.every(x=>!x.text||x.text.includes('Доступ запрещён')));}));
test('admin payment data is unavailable in groups',()=>fixture(async({send,sent})=>{await send(9,'/payments','group');assert.ok(sent.at(-1).text.includes('только в личном'));assert.ok(!sent.at(-1).text.includes('charge-admin-test'));}));
test('refund command requires a second explicit confirmation',()=>fixture(async({store,order,send,callback,refunds})=>{await send(9,'/refund '+order.id);assert.equal(refunds.length,0);assert.equal(store.premium.active(1),true);await callback(9,'payrefund:'+order.id);assert.deepEqual(refunds,[[1,'charge-admin-test']]);assert.equal(store.premium.active(1),false);await callback(9,'payrefund:'+order.id);assert.equal(refunds.length,1);}));
test('failed refund does not revoke premium or pretend success',()=>fixture(async({store,order,send,callback,setFail,sent})=>{setFail(true);await send(9,'/refund '+order.id);await callback(9,'payrefund:'+order.id);assert.equal(store.premium.active(1),true);assert.ok(sent.some(x=>x.text?.includes('не подтвердил результат')));}));
test('payment support can be answered and closed by admin',()=>fixture(async({store,send,replies})=>{const ticket=store.premium.addSupport(1,'Help');await send(9,`/payreply ${ticket.id} Проверяем платёж`);assert.equal(replies.length,1);assert.equal(replies[0][0],1);assert.ok(replies[0][1].includes('Проверяем'));await send(9,'/payclose '+ticket.id);assert.equal(store.premium.openSupport().length,0);}));
