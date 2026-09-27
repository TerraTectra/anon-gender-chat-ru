import test from 'node:test';
import assert from 'node:assert/strict';
import {telegramConnectionStatus,telegramFailureCode} from '../src/telegram-health.js';
import {readPaymentBatch} from '../src/payment-reconciliation.js';

test('running process without successful Telegram polls is not healthy',()=>{
 assert.equal(telegramConnectionStatus({running:true},{polling:{last_success_at_ms:null}},5,100000),'starting');
 assert.equal(telegramConnectionStatus({running:true},{polling:{last_success_at_ms:null}},100,100000),'degraded');
});
test('fresh successful polls are healthy but old or repeatedly failing polls are degraded',()=>{
 const polling={last_success_at_ms:100000,consecutive_errors:0};
 assert.equal(telegramConnectionStatus({running:true},{polling},200,110000),'running');
 assert.equal(telegramConnectionStatus({running:true},{polling},200,191000),'degraded');
 assert.equal(telegramConnectionStatus({running:true},{polling:{...polling,consecutive_errors:3}},200,110000),'degraded');
 assert.equal(telegramConnectionStatus({running:false},{polling},200,110000),'degraded');
});
test('failure diagnostics contain codes rather than secrets or exception URLs',()=>{
 assert.equal(telegramFailureCode({error:{code:'ECONNRESET'}}),'ECONNRESET');
 assert.equal(telegramFailureCode({error_code:429}),'HTTP_429');
 assert.equal(telegramFailureCode({message:'https://example.invalid/credential-secret'}),'NETWORK_ERROR');
 assert.equal(telegramFailureCode({},true),'REQUEST_TIMEOUT');
});
test('bounded ledger scans continue past 1000 instead of rereading only the beginning',async()=>{
 const ledger=Array.from({length:1001},(_,n)=>({id:String(n),date:n}));
 const api={getStarTransactions:async({offset,limit})=>({transactions:ledger.slice(offset,offset+limit)})};
 const first=await readPaymentBatch(api);assert.equal(first.transactions.length,1000);assert.equal(first.complete,false);assert.equal(first.nextOffset,1000);
 const second=await readPaymentBatch(api,first.nextOffset);assert.equal(second.transactions.length,1);assert.equal(second.transactions[0].id,'1000');assert.equal(second.complete,true);assert.equal(second.nextOffset,0);
});
test('ledger rejects invalid cursors and malformed responses',async()=>{
 await assert.rejects(readPaymentBatch({},-1),/invalid_ledger_cursor/);
 await assert.rejects(readPaymentBatch({getStarTransactions:async()=>({})}),/invalid_ledger_response/);
});
