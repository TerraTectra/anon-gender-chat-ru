import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { createUserBot } from '../src/user-bot.js';

async function fixture(run) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'family-command-'));
  const store=new Store(path.join(dir,'test.db'));
  const bot=createUserBot('123456:offline-test',path.join(dir,'test.db'),{store});
  bot.botInfo={id:123456,is_bot:true,first_name:'Test',username:'FamilyTestBot'};
  const sent=[];
  bot.api.config.use(async (_previous,method,payload)=>{
    sent.push({method,...payload});
    return {ok:true,result:method==='copyMessage'?{message_id:100}:{message_id:100,date:1,chat:{id:payload.chat_id,type:'private'},text:payload.text}};
  });
  let update=1;
  const send=async(id,text)=>bot.handleUpdate({update_id:update++,message:{message_id:update,date:1,from:{id,is_bot:false,first_name:'Synthetic'},chat:{id,type:'private'},text,...(text.startsWith('/')?{entities:[{type:'bot_command',offset:0,length:text.split(' ')[0].length}]}:{})}});
  for(const [id,gender]of [[1,'male'],[2,'female'],[3,'female']]){store.upsertUser(id,'synthetic');store.setProfile(id,{age:25,gender});}
  try { await run({store,send,sent}); } finally {store.close();fs.rmSync(dir,{recursive:true,force:true});}
}

test('slash stop disconnects both partners and is never relayed',()=>fixture(async({store,send,sent})=>{
  store.enqueue(1,'random');store.enqueue(2,'random');
  await send(1,'/stop');
  assert.equal(store.getUser(1).partner_id,null);assert.equal(store.getUser(2).partner_id,null);
  assert.ok(sent.some(x=>x.method==='sendMessage'&&x.chat_id===2));
  assert.ok(!sent.some(x=>x.method==='copyMessage'));
}));
test('unknown command does not leak to a partner or end the chat',()=>fixture(async({store,send,sent})=>{
  store.enqueue(1,'random');store.enqueue(2,'random');await send(1,'/private_setting');
  assert.equal(store.getUser(1).partner_id,2);assert.ok(!sent.some(x=>x.method==='copyMessage'));assert.equal(sent.length,1);
}));
test('search aliases create a real match',()=>fixture(async({store,send})=>{
  await send(1,'/search');await send(2,'/search');assert.equal(store.getUser(1).partner_id,2);
}));
test('starting new search informs previous partner',()=>fixture(async({store,send,sent})=>{
  store.enqueue(1,'random');store.enqueue(2,'random');await send(1,'/search');
  assert.equal(store.getUser(2).partner_id,null);assert.ok(sent.some(x=>x.chat_id===2&&x.text.includes('новый поиск')));
}));
test('stop during filter setup clears the pending input step',()=>fixture(async({send,sent})=>{
  await send(1,'/filters');await send(1,'/stop');await send(1,'18-25');
  assert.ok(sent.at(-1).text.includes('Сначала найдите собеседника'));
}));
test('profile command does not become a message to the partner',()=>fixture(async({store,send,sent})=>{
  store.enqueue(1,'random');store.enqueue(2,'random');await send(1,'/profile');
  assert.ok(sent.some(x=>x.text?.includes('Ваш профиль')));assert.ok(!sent.some(x=>x.method==='copyMessage'));
}));
test('report alias presents confirmation without silently reporting',()=>fixture(async({store,send,sent})=>{
  store.enqueue(1,'random');store.enqueue(2,'random');await send(1,'/report');
  assert.equal(store.stats().reports,0);assert.ok(sent.some(x=>x.text?.includes('Жалоба завершит чат')));
}));
test('normal chat text is still relayed',()=>fixture(async({store,send,sent})=>{
  store.enqueue(1,'random');store.enqueue(2,'random');await send(1,'Привет');
  assert.ok(sent.some(x=>x.method==='copyMessage'&&x.chat_id===2));
}));
