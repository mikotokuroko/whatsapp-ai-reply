import { expect, it } from 'vitest';
import { validateConfig, publicConfig, customUrl } from '../src/settings';
export const fixture = { provider: 'gemini', model: 'test-model', apiKey: 'test-key-not-real', baseUrl: '', contacts: ['+14155550123'], dailyLimit: 30, cooldownSeconds: 10, memory: false, instructions: 'Be brief.' };
it('keeps a key only for the same provider and endpoint', () => {
 const saved = validateConfig(fixture);
 expect(validateConfig({ ...fixture, apiKey: '' }, saved).apiKey).toBe(fixture.apiKey);
 expect(() => validateConfig({ ...fixture, provider: 'openai', apiKey: '' }, saved)).toThrow('new key');
 const custom = validateConfig({ ...fixture, provider: 'custom', baseUrl: 'https://api.vendor.com/v1' });
 expect(() => validateConfig({ ...custom, baseUrl: 'https://other.vendor.com/v1', apiKey: '' }, custom)).toThrow();
 expect(publicConfig(saved)).not.toHaveProperty('apiKey');
});
it('validates contacts and bounded budgets', () => {
 for (const overrides of [{contacts:[]},{contacts:['14155550123']},{dailyLimit:0},{dailyLimit:1001},{cooldownSeconds:0},{instructions:'a'.repeat(4001)}]) expect(() => validateConfig({...fixture,...overrides})).toThrow();
 expect(validateConfig({...fixture,contacts:[...fixture.contacts,...fixture.contacts]}).contacts).toHaveLength(1);
});
it('rejects unsafe custom API URLs', () => {
 for (const url of ['http://api.vendor.com/v1','https://127.0.0.1','https://[::1]','https://localhost','https://metadata.internal','https://user:pass@api.vendor.com','https://api.vendor.com/v1?key=x','https://api.vendor.com:8443']) expect(() => customUrl(url)).toThrow();
 expect(customUrl('https://api.vendor.com/v1/')).toBe('https://api.vendor.com/v1');
});
