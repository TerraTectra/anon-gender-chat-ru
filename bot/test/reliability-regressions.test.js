import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { createUserBot } from '../src/user-bot.js';
import { installTelegramReliability, createSingleFlightRetry } from '../src/telegram-reliability.js';

async function fixture(run) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'anon-regression-'));
  const store=new Store(path.join(dir,'test.db'));
  const bot=createUserBot('123456:offline-test',path.join(dir,'test.db'),{store});
  bot.botInfo={id:123456,is_bot:true,first_name:'Test',username:'FamilyTestBot'};
  const sent=[]; let intercept=null;
  bot.api.config.use(async (_previous,method,payload)=>{
    sent.push({method,...payload});
    if(intercept) {const r=await intercept(method,payload);if(r!==undefined)return r;}
    return {ok:true,result:method==='copyMessage'?{message_id:100}:{message_id:100,date:1,chat:{id:payload.chat_id,type:'private'},text:payload.text}};
  });
  let update=1;
  const send=async(id,text)=>bot.handleUpdate({update_id:update++,message:{message_id:update,date:1,from:{id,is_bot:false,first_name:'Synthetic'},chat:{id,type:'private'},text,...(text.startsWith('/')?{entities:[{type:'bot_command',offset:0,length:text.split(' ')[0].length}]}:{})}});
  const callback=async(id,data)=>bot.handleUpdate({update_id:update++,callback_query:{id:String(update),from:{id,is_bot:false,first_name:'Synthetic'},chat_instance:'test',data,message:{message_id:77,date:1,chat:{id,type:'private'},text:'Button'}}});
  for(const [id,gender] of [[1,'male'],[2,'female'],[3,'female']]){store.upsertUser(id,'synthetic');store.setProfile(id,{age:25,gender});}
  try{await run({store,bot,sent,send,callback,setIntercept:fn=>{intercept=fn;}});}
  finally{bot.stopSessionRetention();await bot.drainArchiveJobs();store.close();fs.rmSync(dir,{recursive:true,force:true});}
}

test('next preserves an age-only filter with gender any',()=>fixture(async({store,send})=>{
  store.setProfile(1,{filter_gender:'any',filter_min_age:22,filter_max_age:29});
  store.enqueue(1,'filtered','any',22,29);store.enqueue(2,'random');
  await send(1,'/next');
  const q=store.db.prepare('SELECT * FROM queue WHERE user_id=1').get();
  assert.equal(q.mode,'filtered');assert.equal(q.min_age,22);assert.equal(q.max_age,29);
}));
test('random search resets old filtered mode for next',()=>fixture(async({store,send})=>{
  store.setProfile(1,{filter_gender:'female',search_mode:'filtered'});
  await send(1,'/search');await send(1,'/next');
  assert.equal(store.db.prepare('SELECT mode FROM queue WHERE user_id=1').get().mode,'random');
}));
test('exhausted filtered quota does not disconnect a current pair',()=>fixture(async({store,send})=>{
  store.enqueue(1,'filtered','any',18,99);store.enqueue(2,'random');
  store.db.prepare("INSERT OR REPLACE INTO filtered_usage VALUES(1,date('now'),50)").run();
  await send(1,'/next');assert.equal(store.getUser(1).partner_id,2);assert.equal(store.getUser(2).partner_id,1);
}));
test('transient copy failure preserves the pair and never retries the message',()=>fixture(async({store,send,sent,setIntercept})=>{
  store.enqueue(1,'random');store.enqueue(2,'random');
  setIntercept(method=>{if(method==='copyMessage')throw new Error('temporary network failure');});
  await send(1,'hello');assert.equal(store.getUser(1).partner_id,2);assert.equal(store.getUser(2).partner_id,1);
  assert.equal(sent.filter(x=>x.method==='copyMessage').length,1);
  assert.ok(sent.some(x=>x.text?.includes('Чат не закрыт')));
}));
test('confirmed recipient block disconnects the pair',()=>fixture(async({store,send,setIntercept})=>{
  store.enqueue(1,'random');store.enqueue(2,'random');
  setIntercept(method=>method==='copyMessage'?{ok:false,error_code:403,description:'Forbidden: bot was blocked by the user'}:undefined);
  await send(1,'hello');assert.equal(store.getUser(1).partner_id,null);assert.equal(store.getUser(2).partner_id,null);
  assert.equal(store.db.prepare('SELECT status FROM bot_access WHERE user_id=2').get().status,'blocked');
}));
test('blocked recipients are removed from the matching queue',()=>fixture(async({store})=>{
  store.enqueue(2,'random');store.markBotBlocked(2);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM queue WHERE user_id=2').get().n,0);
  assert.equal(store.enqueue(1,'random').status,'waiting');
}));
test('stale gender button cannot alter an active profile or pair',()=>fixture(async({store,callback})=>{
  store.enqueue(1,'random');store.enqueue(2,'random');
  await callback(1,'profile_gender:female');assert.equal(store.getUser(1).gender,'male');assert.equal(store.getUser(1).partner_id,2);
}));
test('stale report confirmation does not report or disconnect a new pair',()=>fixture(async({store,send,callback})=>{
  store.enqueue(1,'random');store.enqueue(2,'random');await send(1,'/report');
  store.disconnect(1);store.enqueue(1,'random');store.enqueue(3,'random');
  await callback(1,'report:confirm');assert.equal(store.getUser(1).partner_id,3);assert.equal(store.stats().reports,0);
}));
test('failed match notification to one user does not suppress the other',()=>fixture(async({store,send,sent,setIntercept})=>{
  store.enqueue(1,'random');
  setIntercept((method,payload)=>{if(method==='sendMessage'&&payload.chat_id===2)throw new Error('temporary');});
  await send(2,'/search');assert.ok(sent.some(x=>x.chat_id===1&&x.text?.includes('Собеседник найден')));
}));
test('unrelated user updates are not stalled by a slow conversation',()=>fixture(async({store,send,setIntercept})=>{
  store.enqueue(1,'random');store.enqueue(2,'random');let release;let copyStarted;
  const started=new Promise(resolve=>{copyStarted=resolve;});
  setIntercept(async method=>{if(method==='copyMessage'){copyStarted();await new Promise(resolve=>{release=resolve;});}});
  const first=send(1,'slow');await started;let completed=false;
  const second=send(3,'/profile').then(()=>{completed=true;});
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(completed,true);
  release();await Promise.all([first,second]);
}));
test('messages from both participants are ordered before next',()=>fixture(async({store,send,setIntercept})=>{
  store.enqueue(1,'random');store.enqueue(2,'random');let release;let copyStarted;
  const started=new Promise(resolve=>{copyStarted=resolve;});
  setIntercept(async method=>{if(method==='copyMessage'){copyStarted();await new Promise(resolve=>{release=resolve;});}});
  const first=send(1,'ordered');await started;
  const next=send(2,'/next');await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(store.getUser(1).partner_id,2);release();await Promise.all([first,next]);
  assert.equal(store.getUser(1).partner_id,null);
}));

function transformer(options={}){let apply;const bot={api:{config:{use:fn=>{apply=fn;}}}};installTelegramReliability(bot,options);return {apply,bot};}
test('unchanged message and expired callback are harmless, unrelated API errors are not',async()=>{
  const {apply}=transformer();
  assert.equal((await apply(async()=>({ok:false,error_code:400,description:'Bad Request: message is not modified'}),'editMessageText',{})).ok,true);
  assert.equal((await apply(async()=>({ok:false,error_code:400,description:'Bad Request: query is too old'}),'answerCallbackQuery',{})).ok,true);
  assert.equal((await apply(async()=>({ok:false,error_code:400,description:'other error'}),'sendMessage',{})).ok,false);
});
test('bounded network timeout cancels once without retrying sends',async()=>{
  const {apply}=transformer({timeoutMs:15});let calls=0;
  const keepAlive=setTimeout(()=>{},500);
  try{await assert.rejects(apply(async(_method,_payload,signal)=>{calls++;await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));},'sendMessage',{}));assert.equal(calls,1);}finally{clearTimeout(keepAlive);}
});
test('delivery block callback records the destination not the sender',async()=>{
  let blocked;const {apply}=transformer({onForbidden:id=>{blocked=id;}});
  await apply(async()=>({ok:false,error_code:403,description:'Forbidden: bot was blocked by the user'}),'sendMessage',{chat_id:22});assert.equal(blocked,22);
});
test('daily reports cannot overlap and retry with backoff',async()=>{
  let time=0,calls=0,release;const guarded=createSingleFlightRetry(async()=>{calls++;await new Promise(r=>{release=r;});throw new Error('offline');},{now:()=>time,minimumMs:100,maximumMs:400});
  const first=guarded();assert.equal(await guarded(),false);release();await assert.rejects(first);assert.equal(await guarded(),false);assert.equal(calls,1);
  time=100;const second=guarded();release();await assert.rejects(second);assert.equal(calls,2);
  time=299;assert.equal(await guarded(),false);
});

test('polyfilled abort signals are bridged and listeners are removed',async()=>{
  let listener,removed=false;
  const signal={aborted:false,reason:undefined,addEventListener(_name,fn){listener=fn;},removeEventListener(_name,fn){removed=fn===listener;}};
  const {apply}=transformer();
  await apply(async(_method,_payload,nativeSignal)=>{assert.ok(nativeSignal instanceof AbortSignal);listener();assert.equal(nativeSignal.aborted,true);return {ok:true,result:true};},'getMe',{},signal);
  assert.equal(removed,true);
});
test('a non-editable old message is replaced by a new message',async()=>{
  const calls=[];const {apply}=transformer();
  const result=await apply(async(method,payload)=>{calls.push({method,payload});return method==='editMessageText'?{ok:false,error_code:400,description:"Bad Request: message can't be edited"}:{ok:true,result:{message_id:2}};},'editMessageText',{chat_id:1,message_id:1,text:'Updated',reply_markup:{inline_keyboard:[]}});
  assert.equal(result.ok,true);assert.equal(calls[1].method,'sendMessage');assert.equal(calls[1].payload.text,'Updated');assert.equal(calls[1].payload.message_id,undefined);
});

test('shutdown during init prevents a late poller from being started',()=>fixture(async({bot,sent})=>{
  let release;bot.init=()=>new Promise(resolve=>{release=resolve;});
  const start=bot.startConcurrent();await bot.stopConcurrent();release();await start;
  assert.equal(bot.pollingState().running,false);
  assert.equal(sent.some(x=>x.method==='getUpdates'||x.method==='deleteWebhook'),false);
}));
