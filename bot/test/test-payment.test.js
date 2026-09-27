import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {createUserBot} from '../src/user-bot.js';
import {TestPaymentStore,testInvoiceParameters,TEST_PAYMENT_TITLE} from '../src/test-payment.js';

async function fixture(run){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'anon-testpay-')),file=path.join(dir,'chat.db');
 const store=new Store(file),bot=createUserBot('123456:offline-test',file,{store,adminIds:'1'});
 bot.botInfo={id:123456,is_bot:true,first_name:'Test',username:'PaymentTestBot'};
 const ledger=new TestPaymentStore(store.db),sent=[];let seq=1,intercept;
 bot.api.config.use(async(_prev,method,payload)=>{sent.push({method,...payload});const result=await intercept?.(method,payload);return result??{ok:true,result:method==='getStarTransactions'?{transactions:[]}:{message_id:100,date:1,chat:{id:payload.chat_id,type:'private'},text:payload.text}};});
 for(const [id,gender]of [[1,'male'],[2,'female']]){store.upsertUser(id,'test'+id);store.setProfile(id,{age:25,gender});}
 const base=id=>({from:{id,is_bot:false,first_name:'Test'},chat:{id,type:'private'},message_id:seq,date:1});
 const send=(id,text)=>bot.handleUpdate({update_id:seq++,message:{...base(id),text,entities:[{type:'bot_command',offset:0,length:text.split(' ')[0].length}]}});
 const checkout=(id,p)=>bot.handleUpdate({update_id:seq++,pre_checkout_query:{...p,from:base(id).from}});
 const paid=(id,p)=>bot.handleUpdate({update_id:seq++,message:{...base(id),successful_payment:p}});
 const refund=(id,p)=>bot.handleUpdate({update_id:seq++,message:{...base(id),refunded_payment:p}});
 const order=(now=Date.now())=>{ledger.setEnabled(true);const o=ledger.create(1,123456,now);return {o,p:{id:'checkout-'+o.id,currency:'XTR',total_amount:8,invoice_payload:ledger.payload(o),telegram_payment_charge_id:'charge-'+o.id,provider_payment_charge_id:''}};};
 try{await run({store,bot,ledger,sent,send,checkout,paid,refund,order,file,setIntercept:fn=>{intercept=fn;}});}
 finally{bot.stopSessionRetention();await bot.stopPremium();await bot.drainArchiveJobs();store.close();fs.rmSync(dir,{recursive:true,force:true});}
}

test('temporary payment is disabled by default and has no public invoice',()=>fixture(async({ledger,send,sent})=>{assert.equal(ledger.enabled(),false);await send(1,'/testpay');assert.ok(!sent.some(x=>x.method==='sendInvoice'));}));
test('test invoice uses exactly 8 Stars, literal name and no promised benefits',()=>fixture(async({ledger,order})=>{const {o}=order(),p=testInvoiceParameters(ledger,o);assert.equal(p.title,'Тестовая оплата');assert.equal(p.title,TEST_PAYMENT_TITLE);assert.equal(p.currency,'XTR');assert.deepEqual(p.prices,[{label:'Тестовая оплата',amount:8}]);assert.equal(p.provider_token,'');assert.match(p.description,/Ничего не даёт/);assert.ok(!p.subscription_period);}));
test('only the owner can create an invoice or see its menu button',()=>fixture(async({ledger,send,sent})=>{ledger.setEnabled(true);await send(2,'/testpay');await send(2,'/premium');assert.ok(!sent.some(x=>x.method==='sendInvoice'));assert.ok(!JSON.stringify(sent).includes('testpay:create'));await send(1,'/premium');assert.ok(JSON.stringify(sent.at(-1)).includes('testpay:create'));await send(1,'/testpay');assert.equal(sent.filter(x=>x.method==='sendInvoice').length,1);}));
test('repeat invoice requests reuse the same single-use order',()=>fixture(async({ledger,order})=>{const {o}=order();assert.equal(ledger.create(1,123456).id,o.id);assert.equal(ledger.db.prepare('SELECT COUNT(*) n FROM test_payment_orders').get().n,1);}));
test('checkout rejects wrong amount, currency, owner and bot',()=>fixture(async({ledger,order})=>{const {p}=order();for(const args of [[2,123456,p],[1,654321,p],[1,123456,{...p,total_amount:7}],[1,123456,{...p,currency:'RUB'}]])assert.throws(()=>ledger.approve(...args));}));
test('unapproved receipts do not count as paid',()=>fixture(async({ledger,order})=>{const {p}=order();assert.throws(()=>ledger.recordPayment(1,123456,p));assert.equal(ledger.paidByUser(1),undefined);}));
test('a second independent checkout and expired invoices are rejected',()=>fixture(async({ledger,order})=>{const now=Date.now(),{p}=order(now);ledger.approve(1,123456,p,now);assert.throws(()=>ledger.approve(1,123456,{...p,id:'other'}));assert.throws(()=>ledger.approve(1,123456,p,now+86400001));}));
test('successful test payment preserves premium, free limits, profile and live chat exactly',()=>fixture(async({store,ledger,sent,order,checkout,paid})=>{
 const until=Date.now()+86400000;store.db.prepare('INSERT INTO premium_access VALUES(?,?)').run(1,until);store.db.prepare("INSERT INTO filtered_usage VALUES(1,date('now'),43)").run();store.enqueue(1,'random');store.enqueue(2,'random');
 const before=JSON.stringify({users:store.db.prepare('SELECT * FROM users ORDER BY id').all(),access:store.db.prepare('SELECT * FROM premium_access').all(),usage:store.db.prepare('SELECT * FROM filtered_usage').all()});
 const {p}=order();await checkout(1,p);assert.equal(ledger.paidByUser(1),undefined);await paid(1,p);
 assert.equal(sent.find(x=>x.method==='answerPreCheckoutQuery').ok,true);assert.ok(ledger.paidByUser(1));assert.equal(store.premium.recentPayments().length,0);
 const after=JSON.stringify({users:store.db.prepare('SELECT * FROM users ORDER BY id').all(),access:store.db.prepare('SELECT * FROM premium_access').all(),usage:store.db.prepare('SELECT * FROM filtered_usage').all()});assert.equal(after,before);assert.ok(sent.some(x=>x.text?.includes('Премиум, лимиты и функции не изменились')));assert.ok(!sent.some(x=>x.method==='copyMessage'));
}));
test('free users receive no entitlement from the 8-Star test',()=>fixture(async({store,order,checkout,paid})=>{const {p}=order();await checkout(1,p);await paid(1,p);assert.equal(store.premium.until(1),0);assert.equal(store.filteredRemaining(1),50);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM premium_access').get().n,0);}));
test('replayed successful payment is recorded once and hides purchase button',()=>fixture(async({bot,ledger,sent,order,checkout,paid,send})=>{const {p}=order();await checkout(1,p);await paid(1,p);await paid(1,p);assert.equal(sent.filter(x=>x.text?.includes('Проверка прошла')).length,1);assert.equal(bot.testPaymentAvailable(1),false);await send(1,'/testpay');assert.ok(!sent.some(x=>x.method==='sendInvoice'));assert.equal(ledger.db.prepare('SELECT COUNT(*) n FROM test_payment_orders WHERE paid_ms IS NOT NULL').get().n,1);}));
test('disabling blocks new charges but still records delayed confirmed payments',()=>fixture(async({ledger,order,checkout,paid,sent})=>{const {p}=order();await checkout(1,p);ledger.setEnabled(false);await checkout(1,p);assert.equal(sent.filter(x=>x.method==='answerPreCheckoutQuery').at(-1).ok,false);await paid(1,p);assert.ok(ledger.paidByUser(1));}));
test('refunds remain recordable after the temporary feature is disabled',()=>fixture(async({store,ledger,order,checkout,paid,refund})=>{const {p}=order();await checkout(1,p);await paid(1,p);ledger.setEnabled(false);await refund(1,p);await refund(1,p);assert.ok(ledger.paidByUser(1).refunded_ms);assert.equal(store.premium.until(1),0);}));
test('refund before receipt does not send a false payment confirmation',()=>fixture(async({ledger,sent,order,checkout,paid,refund})=>{const {p}=order();await checkout(1,p);await refund(1,p);await paid(1,p);assert.ok(ledger.paidByUser(1).refunded_ms);assert.ok(!sent.some(x=>x.text?.includes('Проверка прошла')));}));
test('test ledger persists independently after reopening SQLite',()=>fixture(async({file,store,ledger,order})=>{const {p}=order();ledger.approve(1,123456,p);ledger.recordPayment(1,123456,p);const reopened=new Store(file);try{const copy=new TestPaymentStore(reopened.db);assert.equal(copy.paidByUser(1).charge_id,p.telegram_payment_charge_id);assert.equal(reopened.premium.until(1),0);}finally{reopened.close();}}));
test('regular premium checkout still follows its original handler',()=>fixture(async({store,ledger,checkout,paid})=>{ledger.setEnabled(true);const o=store.premium.createOrder(1,123456,'week');store.premium.acceptOrder(1,123456,o.id);const p={id:'premium-query',currency:'XTR',total_amount:25,invoice_payload:store.premium.payload(o),telegram_payment_charge_id:'premium-charge'};await checkout(1,p);await paid(1,p);assert.equal(store.premium.active(1),true);assert.equal(ledger.paidByUser(1),undefined);}));
test('Telegram ledger recovers a missed test receipt without granting premium',()=>fixture(async({bot,ledger,store,order,setIntercept})=>{const {p}=order();ledger.approve(1,123456,p);setIntercept(method=>method==='getStarTransactions'?{ok:true,result:{transactions:[{id:p.telegram_payment_charge_id,date:Math.floor(Date.now()/1000),amount:8,source:{type:'user',transaction_type:'invoice_payment',user:{id:1},invoice_payload:p.invoice_payload}}]}}:undefined);await bot.reconcilePremium();assert.ok(ledger.paidByUser(1));assert.equal(store.premium.until(1),0);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM payment_anomalies').get().n,0);}));
