import {HttpsProxyAgent} from 'https-proxy-agent';
const agents=new Map();

export function validateLocalProxy(value=''){
 const text=String(value||'').trim();
 if(!text)return null;
 let url;try{url=new URL(text);}catch{throw new Error('TELEGRAM_PROXY_URL must be a valid loopback proxy URL');}
 if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('TELEGRAM_PROXY_URL must point to a local proxy without credentials or path');
 return url.href;
}

export function telegramClientOptions(value=process.env.TELEGRAM_PROXY_URL){
 const proxy=validateLocalProxy(value);
 if(!proxy)return {timeoutSeconds:70};
 let agent=agents.get(proxy);
 if(!agent){agent=new HttpsProxyAgent(proxy,{keepAlive:true,maxSockets:32,maxFreeSockets:4});agents.set(proxy,agent);}
 // The proxy handles CONNECT; end-to-end TLS certificate verification remains enabled.
 return {timeoutSeconds:70,baseFetchConfig:{agent,compress:true}};
}
export function closeTelegramTransport(){for(const agent of agents.values())agent.destroy();agents.clear();}
export function telegramTransportMode(){return validateLocalProxy(process.env.TELEGRAM_PROXY_URL)?'local_proxy':'default_route';}
