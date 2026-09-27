import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLocalProxy,telegramClientOptions,closeTelegramTransport} from '../src/telegram-transport.js';

test('no proxy setting preserves the original network route',()=>{
 assert.equal(validateLocalProxy(''),null);assert.deepEqual(telegramClientOptions(''),{timeoutSeconds:70});
});
test('only explicit loopback HTTP proxies are accepted',()=>{
 assert.equal(validateLocalProxy('http://127.0.0.1:10808'),'http://127.0.0.1:10808/');
 assert.equal(validateLocalProxy('http://[::1]:10808'),'http://[::1]:10808/');
 for(const url of ['http://example.invalid:8080','socks5://127.0.0.1:10808','http://user:secret@127.0.0.1:10808','http://127.0.0.1:10808/path','http://127.0.0.1:10808/?secret=1'])assert.throws(()=>validateLocalProxy(url));
});
test('configured clients reuse a bounded connection agent and keep TLS defaults',()=>{
 try{const first=telegramClientOptions('http://127.0.0.1:10808'),second=telegramClientOptions('http://127.0.0.1:10808');assert.equal(first.baseFetchConfig.agent,second.baseFetchConfig.agent);assert.equal(first.baseFetchConfig.agent.maxSockets,32);assert.equal(first.baseFetchConfig.rejectUnauthorized,undefined);}finally{closeTelegramTransport();}
});
test('closing transport releases cached agents',()=>{
 const first=telegramClientOptions('http://127.0.0.1:10808').baseFetchConfig.agent;closeTelegramTransport();const second=telegramClientOptions('http://127.0.0.1:10808').baseFetchConfig.agent;assert.notEqual(first,second);closeTelegramTransport();
});
