import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { TestPaymentStore } from '../src/test-payment.js';
import { createAdminBot } from '../src/admin-bot.js';
import { formatStarBalance, PAYMENTS_LABEL } from '../src/payment-admin-panel.js';

async function fixture(run) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'refund-panel-')),file=path.join(dir,'chat.db');
 const store=new Store(file),ledger=new TestPaymentStore(store.db);
 store.upsertUser(1,'test');store.setProfile(1,{age:25,gender:'male'});
 const now=Date.now();
 const porder=store.premium.createOrder(1,123456,'week',now);
 store.premium.acceptOrder(1,123456,porder.id,now);
 const receipt={id:'premium-checkout',currency:'XTR',total_amount:25,invoice_payload:store.premium.payload(porder),telegram_payment_charge_id:'premium-charge'};
 store.premium.approve(1,123456,receipt,now);store.premium.applyPayment(1,123456,receipt,now);
 ledger.setEnabled(true);const order=ledger.create(1,123456,now+1);
 const payment={id:'test-checkout',currency:'XTR',total_amount:8,invoice_payload:ledger.payload(order),telegram_payment_charge_id:'test-charge'};
 ledger.approve(1,123456,payment,now+1);ledger.recordPayment(1,123456,payment,now+2);
 const sent=[],refunds=[],notifications=[];
 let balance={amount:8},refundMode='ok',botId=123456,failNotice=false,refundWait=null;
 const bot=createAdminBot('654321:offline-test',file,'9,10',{
  sourcePaymentBalance:async()=>{if(balance instanceof Error)throw balance;return balance;},
  sourcePaymentBotId:()=>botId,
  sourcePaymentRefund:async(...args)=>{refunds.push(args);if(refundWait)await refundWait;if(refundMode==='error')throw new Error('network down');if(refundMode==='already')throw new Error('CHARGE_ALREADY_REFUNDED');return refundMode==='false'?false:true;},
  sourcePaymentMessage:async(...args)=>{notifications.push(args);if(failNotice)throw new Error('blocked');return true;},
  sourcePaymentReconcile:async()=>({restored:0,refunded:0,review:0,complete:true})
 });
 bot.botInfo={id:654321,is_bot:true,first_name:'Admin',username:'AdminPanelTestBot'};
 bot.api.config.use(async(_previous,method,payload)=>{sent.push({method,...payload});return {ok:true,result:{message_id:1,date:1,chat:{id:payload.chat_id,type:'private'},text:payload.text}};});
 let seq=1;
 const send=(id,text,type='private')=>bot.handleUpdate({update_id:seq++,message:{message_id:seq,date:1,from:{id,is_bot:false,first_name:'Test'},chat:{id:type==='private'?id:-99,type},text,...(text.startsWith('/')?{entities:[{type:'bot_command',offset:0,length:text.split(' ')[0].length}]}:{})}});
 const callback=(id,data,type='private')=>bot.handleUpdate({update_id:seq++,callback_query:{id:String(seq),from:{id,is_bot:false,first_name:'Test'},chat_instance:'test',data,message:{message_id:1,date:1,chat:{id:type==='private'?id:-99,type},text:'button'}}});
 const buttons=()=>sent.flatMap(x=>x.reply_markup?.inline_keyboard?.flat()||[]);
 try{await run({store,ledger,order,porder,sent,refunds,notifications,send,callback,buttons,setBalance:x=>{balance=x;},setRefund:x=>{refundMode=x;},setBot:x=>{botId=x;},failNotice:()=>{failNotice=true;},waitRefund:x=>{refundWait=x;}});}
 finally{bot.stopDailyReportScheduler();bot.closeStore();store.close();fs.rmSync(dir,{recursive:true,force:true});}
}

test('live Stars formatting does not truncate fractional or negative values',()=>{
 assert.equal(formatStarBalance({amount:8}),'8');assert.equal(formatStarBalance({amount:8,nanostar_amount:500000000}),'8,5');assert.equal(formatStarBalance({amount:0,nanostar_amount:-500000000}),'-0,5');assert.throws(()=>formatStarBalance({amount:NaN}));
});
test('payments, balance and menu button show actual bot balance and both payment types',()=>fixture(async({send,sent,buttons,order,porder})=>{
 for(const text of ['/payments','/balance',PAYMENTS_LABEL])await send(9,text);
 assert.equal(sent.filter(x=>x.text?.includes('Баланс основного бота: 8 ⭐')).length,3);
 assert.ok(buttons().some(b=>b.callback_data==='payment:t:'+order.id));assert.ok(buttons().some(b=>b.callback_data==='payment:p:'+porder.id));
 assert.ok(sent.some(x=>x.text?.includes('не ваш личный баланс')));
 for(const button of buttons())if(button.callback_data)assert.ok(Buffer.byteLength(button.callback_data)<=64);
}));
test('test payment detail exposes a refund button but never executes it on open',()=>fixture(async({callback,sent,buttons,order,refunds})=>{
 await callback(9,'payment:t:'+order.id);assert.ok(sent.some(x=>x.text?.startsWith('Тестовая оплата')));assert.ok(buttons().some(x=>x.text==='↩️ Вернуть 8 ⭐'));assert.equal(refunds.length,0);
 await callback(9,'refundask:t:'+order.id);assert.ok(buttons().some(x=>x.text==='Подтвердить возврат 8 ⭐'));assert.equal(refunds.length,0);
}));
test('test refund targets the original charge and preserves all premium and profile state',()=>fixture(async({store,ledger,callback,order,refunds,notifications,sent})=>{
 const user={...store.getUser(1)},until=store.premium.until(1),usage=store.filteredRemaining(1);
 await callback(9,'refundask:t:'+order.id);await callback(9,'testrefund:'+order.id);
 assert.deepEqual(refunds,[[1,'test-charge']]);assert.ok(ledger.order(order.id).refunded_ms);assert.equal(store.premium.until(1),until);assert.equal(store.filteredRemaining(1),usage);assert.deepEqual({...store.getUser(1)},user);
 assert.ok(sent.some(x=>x.text?.includes('Возвращено 8 ⭐')));assert.ok(notifications[0][1].includes('не менялись'));
 await callback(9,'testrefund:'+order.id);assert.equal(refunds.length,1);
}));
test('legacy refund command also finds the test payment',()=>fixture(async({send,callback,order,refunds})=>{
 await send(9,'/refund '+order.id);assert.equal(refunds.length,0);await callback(9,'testrefund:'+order.id);assert.equal(refunds.length,1);
}));
test('confirmation cannot be forged, reused after cancel or consumed by another admin',()=>fixture(async({callback,order,refunds})=>{
 await callback(9,'testrefund:'+order.id);assert.equal(refunds.length,0);
 await callback(9,'refundask:t:'+order.id);await callback(10,'testrefund:'+order.id);assert.equal(refunds.length,0);
 await callback(9,'payrefund:cancel');await callback(9,'testrefund:'+order.id);assert.equal(refunds.length,0);
}));
test('non-admin cannot read balance, open payment or refund',()=>fixture(async({send,callback,order,sent,refunds})=>{
 await send(1,'/balance');await callback(1,'payment:t:'+order.id);await callback(1,'refundask:t:'+order.id);await callback(1,'testrefund:'+order.id);
 assert.equal(refunds.length,0);assert.ok(sent.every(x=>!x.text||x.text.includes('Доступ запрещён')));
}));
test('even an admin cannot refund from a group',()=>fixture(async({callback,order,refunds})=>{
 await callback(9,'refundask:t:'+order.id);await callback(9,'testrefund:'+order.id,'group');assert.equal(refunds.length,0);
}));
test('balance failure leaves payment access available without presenting a zero balance',()=>fixture(async({setBalance,send,sent,buttons,order})=>{
 setBalance(new Error('network'));await send(9,'/balance');assert.ok(sent.at(-1).text.includes('НЕ считается нулевым'));assert.ok(buttons().some(b=>b.callback_data==='payment:t:'+order.id));
}));
test('a refund network error preserves the paid record and requires fresh confirmation',()=>fixture(async({setRefund,callback,ledger,order,refunds,sent})=>{
 setRefund('error');await callback(9,'refundask:t:'+order.id);await callback(9,'testrefund:'+order.id);assert.equal(ledger.order(order.id).refunded_ms,null);assert.ok(sent.some(x=>x.text?.includes('не подтвердил результат')));
 await callback(9,'testrefund:'+order.id);assert.equal(refunds.length,1);
}));
test('a false Telegram response is never treated as confirmed refund',()=>fixture(async({setRefund,callback,ledger,order})=>{
 setRefund('false');await callback(9,'refundask:t:'+order.id);await callback(9,'testrefund:'+order.id);assert.equal(ledger.order(order.id).refunded_ms,null);
}));
test('refund remains available when temporary purchase has been disabled',()=>fixture(async({ledger,callback,order})=>{
 ledger.setEnabled(false);await callback(9,'refundask:t:'+order.id);await callback(9,'testrefund:'+order.id);assert.ok(ledger.order(order.id).refunded_ms);
}));
test('a previously confirmed Telegram refund is reconciled without a new charge',()=>fixture(async({setRefund,callback,ledger,order})=>{
 setRefund('already');await callback(9,'refundask:t:'+order.id);await callback(9,'testrefund:'+order.id);assert.ok(ledger.order(order.id).refunded_ms);
}));
test('wrong paying-bot identity blocks the remote refund call',()=>fixture(async({setBot,callback,order,refunds})=>{
 setBot(999);await callback(9,'refundask:t:'+order.id);await callback(9,'testrefund:'+order.id);assert.equal(refunds.length,0);
}));
test('blocked user notification cannot reverse confirmed refund status',()=>fixture(async({failNotice,callback,ledger,order,sent})=>{
 failNotice();await callback(9,'refundask:t:'+order.id);await callback(9,'testrefund:'+order.id);assert.ok(ledger.order(order.id).refunded_ms);assert.ok(!sent.some(x=>x.text?.includes('не подтвердил результат')));
}));
test('refunded detail has no button for another refund',()=>fixture(async({callback,order,sent})=>{
 await callback(9,'refundask:t:'+order.id);await callback(9,'testrefund:'+order.id);sent.length=0;await callback(9,'payment:t:'+order.id);assert.ok(!sent.flatMap(x=>x.reply_markup?.inline_keyboard?.flat()||[]).some(x=>x.callback_data?.startsWith('refundask:')));
}));
test('support UI provides navigation to payment and refund cards',()=>fixture(async({callback,buttons})=>{
 await callback(9,'payments:support');assert.ok(buttons().some(b=>b.text==='💳 Платежи и возвраты'));
}));
test('parallel double confirmation issues only one API refund',()=>fixture(async({waitRefund,callback,order,refunds})=>{
 let release;waitRefund(new Promise(r=>{release=r;}));await callback(9,'refundask:t:'+order.id);
 const first=callback(9,'testrefund:'+order.id);for(let i=0;i<20&&refunds.length===0;i++)await new Promise(r=>setTimeout(r,1));
 await callback(9,'testrefund:'+order.id);assert.equal(refunds.length,1);release();await first;
}));
