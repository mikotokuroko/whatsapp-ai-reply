// Local-only HTTP/storage check. Never pairs WhatsApp or calls an AI provider.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import './wasm.mjs';
await mkdir('.wrangler', { recursive: true });
const scratch = await mkdtemp('.wrangler/smoke-');
const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
const token = 'local-smoke-test-password-not-a-real-secret';
const origin = `http://127.0.0.1:${port}`;
let child, output = '';
async function launch() {
  child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', scratch, '--var', `ADMIN_TOKEN:${token}`], { stdio: ['ignore','pipe','pipe'], env: { ...process.env, WRANGLER_LOG_PATH: '.wrangler/logs', WRANGLER_SEND_METRICS: 'false' } });
  child.stdout.on('data', b => { output += b }); child.stderr.on('data', b => { output += b });
  for (let attempt=0; attempt<80; attempt++) {
    if(child.exitCode!==null) throw Error('Local runtime exited: '+output);
    try { const r=await fetch(origin+'/api/status'); if(r.status===401)return; }catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw Error('Local runtime did not start: '+output);
}
async function stop(){if(!child||child.exitCode!==null)return;const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
async function call(action,body){const r=await fetch(origin+'/api/'+action,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
try {
 await launch();
 const html=await(await fetch(origin)).text();assert(html.includes('Custom OpenAI-compatible API'));
 assert.equal((await call('status')).body.settings,null);
 assert.equal((await call('settings',{})).status,400);
 const settings={provider:'gemini',model:'smoke-model',apiKey:'fake-key-local-smoke',contacts:['+14155550123'],dailyLimit:40,cooldownSeconds:5,memory:false,instructions:'Use brief answers.',baseUrl:''};
 assert.equal((await call('settings',settings)).status,200);
 assert.equal((await call('settings',{...settings,apiKey:'',dailyLimit:50})).status,200);
 const before=(await call('status')).body;assert.equal(before.settings.dailyLimit,50);assert.equal(before.settings.hasApiKey,true);assert.equal(JSON.stringify(before).includes(settings.apiKey),false);assert.equal(before.enabled,false);
 await stop();await launch();
 const after=(await call('status')).body;assert.equal(after.settings.instructions,settings.instructions);assert.equal(after.settings.dailyLimit,50);assert.equal(after.enabled,false);
 assert.equal((await call('settings',{...settings,provider:'custom',baseUrl:'https://localhost'})).status,400);
 console.log('Passed: real workerd HTTP authentication, input errors, secret redaction, settings updates and persisted state after restart. No external messages or AI calls.');
} finally {await stop();await rm(scratch,{recursive:true,force:true});}
