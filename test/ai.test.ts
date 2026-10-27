import { expect, it, vi } from 'vitest';
import { buildRequest, generate } from '../src/ai';
import { validateConfig } from '../src/settings';
const fixture = { provider: 'gemini', model: 'test-model', apiKey: 'test-key-not-real', baseUrl: '', contacts: ['+14155550123'], dailyLimit: 30, cooldownSeconds: 10, memory: false, instructions: 'Be brief.' };
const messages = [{ role: 'user' as const, content: 'hello' }];
it.each(['gemini','openai','anthropic','openrouter','custom'])('formats and parses %s responses', async provider => {
 const config = validateConfig({ ...fixture, provider, baseUrl: 'https://api.vendor.com/v1' });
 const reply = provider === 'gemini' ? { candidates: [{content:{parts:[{text:'secret reasoning',thought:true},{text:'OK'}]}}] } : provider === 'anthropic' ? {content:[{type:'thinking',thinking:'secret'},{type:'text',text:'OK'}]} : {choices:[{message:{content:'OK'}}]};
 const fetcher = vi.fn().mockResolvedValue(Response.json(reply));
 expect(await generate(config,messages,fetcher)).toBe('OK');
 const [url,options]=fetcher.mock.calls[0];
 expect(url).not.toContain(config.apiKey);expect(options.redirect).toBe('error');
 const body=JSON.parse(options.body);
 if(provider==='gemini') expect(body.systemInstruction.parts[0].text).toBe('Be brief.');
 else if(provider==='anthropic') expect(body.system).toBe('Be brief.');
 else expect(body.messages[0]).toEqual({role:'system',content:'Be brief.'});
});
it('does not retry or expose provider error bodies',async()=>{
 const f=vi.fn().mockResolvedValue(new Response('PRIVATE',{status:401}));
 await expect(generate(validateConfig(fixture),messages,f)).rejects.toThrow('rejected');expect(f).toHaveBeenCalledTimes(1);
});
it('bounds output and refuses malformed or oversized responses',async()=>{
 const config=validateConfig(fixture);
 await expect(generate(config,messages,vi.fn().mockResolvedValue(new Response('a'.repeat(262145))))).rejects.toThrow('size');
 await expect(generate(config,messages,vi.fn().mockResolvedValue(Response.json({})))).rejects.toThrow('No text');
 expect(buildRequest(config,messages,true).body.generationConfig).toEqual({maxOutputTokens:128});
});
