import { beforeEach, expect, it, vi } from 'vitest';
const mock=vi.hoisted(()=>({create:vi.fn(),auth:vi.fn(),generate:vi.fn()}));
vi.mock('cloudflare:workers',()=>({DurableObject:class{constructor(public ctx:any, public env:any){}}}));
vi.mock('../src/bridge.wasm',()=>({default:new Uint8Array()}));
vi.mock('@oxidezap/whatsapp-rust-bridge/host',()=>({initSync:vi.fn()}));
vi.mock('@oxidezap/baileyrs/host',()=>({default:mock.create,createAuthenticationState:mock.auth,setLoggerSink:vi.fn()}));
vi.mock('../src/ai',async original=>({...await original<typeof import('../src/ai')>(),generate:mock.generate}));
import worker,{ReplyBot} from '../src/worker';
const config={provider:'gemini',model:'test-model',apiKey:'test-key-not-real',baseUrl:'',contacts:['+14155550123','+442079460123'],dailyLimit:30,cooldownSeconds:1,memory:true,instructions:'Be brief.'};
function setup(values=new Map<string,any>()){
 const claims=new Set<string>();let initialized:Promise<unknown>;const waits:Promise<unknown>[]=[];
 const storage={get:async(k:string)=>values.get(k),put:async(k:string,v:any)=>{values.set(k,structuredClone(v))},setAlarm:vi.fn(),deleteAlarm:vi.fn(),sql:{exec:(sql:string,...args:any[])=>({toArray:()=>{if(!sql.startsWith('INSERT OR IGNORE INTO deliveries'))return[];if(claims.has(args[0]))return[];claims.add(args[0]);return[{id:args[0]}]}})}};
 const ctx={storage,blockConcurrencyWhile:(fn:()=>Promise<unknown>)=>{initialized=fn()},waitUntil:(p:Promise<unknown>)=>waits.push(p)};
 const bot=new ReplyBot(ctx as any,{REPLY_BOT:{} as any,ADMIN_TOKEN:'x'.repeat(64)});
 return{bot,values,storage,waits,ready:()=>initialized};
}
let handlers:Record<string,Function>,socket:any;
beforeEach(()=>{vi.resetAllMocks();handlers={};socket={ev:{on:(name:string,fn:Function)=>handlers[name]=fn},end:vi.fn(),sendMessage:vi.fn().mockResolvedValue({})};mock.create.mockReturnValue(socket);mock.auth.mockResolvedValue({creds:{registered:true}});mock.generate.mockResolvedValue('Hello');});
async function online(s:ReturnType<typeof setup>){await s.ready();await s.bot.command('settings',config);await s.bot.command('start',{});handlers['connection.update']({connection:'open'});await Promise.all(s.waits);await s.bot.command('enable',{});}
function emit(contact='14155550123',id='one'){handlers['messages.upsert']({type:'notify',messages:[{key:{id,remoteJid:contact+'@s.whatsapp.net'},messageTimestamp:Math.ceil(Date.now()/1000),message:{conversation:'hello'}}]});}
it('requires auth and rejects cross-origin admin requests',async()=>{
 const env={ADMIN_TOKEN:'x'.repeat(64),REPLY_BOT:{getByName:vi.fn()} as any};
 expect((await worker.fetch(new Request('https://bot/api/status'),env)).status).toBe(401);
 expect((await worker.fetch(new Request('https://bot/api/status',{headers:{Authorization:'Bearer '+env.ADMIN_TOKEN,Origin:'https://other'}}),env)).status).toBe(403);
 expect(env.REPLY_BOT.getByName).not.toHaveBeenCalled();
});
it('restores sessions through alarms and does not restart a connecting socket',async()=>{
 const s=setup(new Map([['mode',{running:true,enabled:false,blocked:false,retryAfter:0,pairingDeadline:0}]]));await s.ready();await s.bot.alarm();await s.bot.alarm();expect(mock.create).toHaveBeenCalledTimes(1);expect(mock.create.mock.calls[0][0].shouldSyncHistoryMessage()).toBe(false);
});
it('stops recovery on logout and preserves the block after restart',async()=>{
 const s=setup();await online(s);handlers['connection.update']({connection:'close',lastDisconnect:{error:{output:{statusCode:401}}}});await Promise.all(s.waits);
 const next=setup(s.values);await next.ready();await next.bot.alarm();expect(mock.create).toHaveBeenCalledTimes(1);expect((await next.bot.status()).enabled).toBe(false);
});
it('does not share memory across contacts and rejects duplicate deliveries',async()=>{
 const s=setup();await online(s);emit();await Promise.all(s.waits);emit('442079460123','two');await Promise.all(s.waits);
 expect(mock.generate.mock.calls[1][1]).toEqual([{role:'user',content:'hello'}]);
 const usage=s.values.get('usage');usage.contacts={};s.values.set('usage',usage);emit();await Promise.all(s.waits);expect(mock.generate).toHaveBeenCalledTimes(2);
});
it('enforces custom daily caps with visible status',async()=>{
 const s=setup();await online(s);await s.bot.command('settings',{...config,dailyLimit:1});emit();await Promise.all(s.waits);emit('442079460123','two');await Promise.all(s.waits);
 expect(mock.generate).toHaveBeenCalledTimes(1);expect((await s.bot.status()).lastEvent).toContain('daily reply limit');expect((await s.bot.status()).usage.remaining).toBe(0);
});
it('settings changes invalidate pending replies and retain keys without reconnecting',async()=>{
 const s=setup();await online(s);let resolve!:(s:string)=>void;mock.generate.mockImplementation(()=>new Promise(r=>resolve=r));emit();await vi.waitFor(()=>expect(mock.generate).toHaveBeenCalledTimes(1));
 await s.bot.command('settings',{...config,apiKey:'',instructions:'Changed'});resolve('OLD');await Promise.all(s.waits);expect(socket.sendMessage).not.toHaveBeenCalled();expect(socket.end).not.toHaveBeenCalled();expect(s.values.get('config').apiKey).toBe(config.apiKey);expect(JSON.stringify(await s.bot.status())).not.toContain(config.apiKey);
});
it('AI testing uses a canned prompt, not contacts or conversation history',async()=>{
 const s=setup();await online(s);await s.bot.testAI();expect(mock.generate.mock.calls[0][1]).toEqual([{role:'user',content:'Connection test. Reply OK.'}]);expect(socket.sendMessage).not.toHaveBeenCalled();await expect(s.bot.testAI()).rejects.toThrow('10 seconds');
});
