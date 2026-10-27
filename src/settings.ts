export const providers = ['gemini', 'openai', 'anthropic', 'openrouter', 'custom'] as const;
export type Provider = typeof providers[number];
export const defaultInstructions = 'You are a helpful AI assistant, not the owner of this WhatsApp account. Match the contact’s language and keep replies clear and concise. Be honest about uncertainty and your capabilities. Do not request passwords or verification codes.';
export interface Config {
  provider: Provider; model: string; apiKey: string; baseUrl: string;
  contacts: string[]; dailyLimit: number; cooldownSeconds: number; memory: boolean; instructions: string;
}
export class InputError extends Error { override name = "InputError"; }
const fail = (text: string): never => { throw new InputError(text); };
export function customUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512) return fail('Enter a public HTTPS API base URL.');
  let u: URL;
  try { u = new URL(value); } catch { return fail('Enter a valid HTTPS API base URL.'); }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash ||
      u.port && u.port !== '443' || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ||
      /(^|\.)(localhost|local|internal|test|invalid|example|lan|home|onion)$/.test(host)) return fail('Use a public HTTPS hostname without credentials, query parameters or a custom port.');
  return u.href.replace(/\/+$/, '');
}
export function validateConfig(raw: unknown, previous?: Config): Config {
  if (!raw || typeof raw !== 'object') return fail('Settings must be an object.');
  const v = raw as Record<string, unknown>;
  if (!providers.includes(v.provider as Provider)) return fail('Choose an AI provider.');
  const provider = v.provider as Provider;
  if (typeof v.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(v.model)) return fail('Enter the model ID from your provider.');
  const baseUrl = provider === 'custom' ? customUrl(v.baseUrl) : '';
  const sameDestination = previous?.provider === provider && previous.baseUrl === baseUrl;
  const apiKey = v.apiKey === '' && sameDestination ? previous!.apiKey : v.apiKey;
  if (typeof apiKey !== 'string' || apiKey.length < 8 || apiKey.length > 4096 || /\s/.test(apiKey)) return fail('Enter an API key. Changing provider or API URL requires a new key.');
  if (!Array.isArray(v.contacts) || !v.contacts.length || v.contacts.length > 20 || v.contacts.some(n => typeof n !== 'string' || !/^\+[1-9]\d{7,14}$/.test(n))) return fail('Enter 1–20 full WhatsApp numbers starting with +, including country codes.');
  if (!Number.isInteger(v.dailyLimit) || Number(v.dailyLimit) < 1 || Number(v.dailyLimit) > 1000) return fail('Daily limit must be 1–1000.');
  if (!Number.isInteger(v.cooldownSeconds) || Number(v.cooldownSeconds) < 1 || Number(v.cooldownSeconds) > 3600) return fail('Cooldown must be 1–3600 seconds.');
  if (typeof v.memory !== 'boolean') return fail('Choose whether to enable memory.');
  if (typeof v.instructions !== 'string' || v.instructions.length > 4000) return fail('Reply instructions must be at most 4,000 characters.');
  return { provider, model: v.model, apiKey, baseUrl, contacts: [...new Set(v.contacts as string[])], dailyLimit: Number(v.dailyLimit), cooldownSeconds: Number(v.cooldownSeconds), memory: v.memory, instructions: v.instructions.trim() || defaultInstructions };
}
export function publicConfig(config?: Config) {
  if (!config) return null;
  const { apiKey, ...safe } = config;
  return { ...safe, hasApiKey: !!apiKey };
}
