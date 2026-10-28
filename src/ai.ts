import type { ImageInput } from './images';
import type { Config } from './settings';
export type Message = { role: 'user' | 'assistant'; content: string; image?: ImageInput };
export class AIError extends Error { override name = "AIError"; }
export function buildRequest(config: Config, messages: Message[], test = false) {
  const { provider, model, apiKey, instructions } = config;
  const max = test ? 128 : 768;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  let url: string, body: Record<string, unknown>;
  if (provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    headers['x-goog-api-key'] = apiKey;
    body = { systemInstruction: { parts: [{ text: instructions }] }, contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }, ...(m.image ? [{ inlineData: { mimeType: m.image.mimeType, data: m.image.data } }] : [])] })), generationConfig: { maxOutputTokens: max } };
  } else if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages';
    headers['x-api-key'] = apiKey; headers['anthropic-version'] = '2023-06-01';
    body = { model, system: instructions, messages: messages.map(m => ({ role: m.role, content: m.image ? [{ type: 'image', source: { type: 'base64', media_type: m.image.mimeType, data: m.image.data } }, { type: 'text', text: m.content }] : m.content })), max_tokens: max };
  } else {
    const base = provider === 'openai' ? 'https://api.openai.com/v1' : provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : config.baseUrl;
    url = base + '/chat/completions'; headers.authorization = 'Bearer ' + apiKey;
    body = { model, messages: [{ role: 'system', content: instructions }, ...messages.map(m => ({ role: m.role, content: m.image ? [{ type: 'text', text: m.content }, { type: 'image_url', image_url: { url: 'data:' + m.image.mimeType + ';base64,' + m.image.data } }] : m.content }))], stream: false,
      ...(provider === 'openai' ? { max_completion_tokens: max } : { max_tokens: max }) };
  }
  return { url, headers, body };
}
export async function generate(config: Config, messages: Message[], request = fetch, test = false): Promise<string> {
  const { url, headers, body } = buildRequest(config, messages, test);
  let response: Response;
  try { response = await request(url, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30_000) }); }
  catch { throw new AIError('AI request timed out or could not connect.'); }
  if (!response.ok) {
    const code = response.status;
    throw new AIError(code === 401 || code === 403 ? 'AI provider rejected the key or access.' : code === 429 ? 'AI provider quota or rate limit reached.' : code === 404 ? 'Model or API endpoint not found.' : 'AI provider could not complete the request. Check the model and provider settings.');
  }
  // Bound responses even for a custom endpoint. Never log provider bodies.
  const reader = response.body?.getReader();
  if (!reader) throw new AIError('AI provider returned no response.');
  let bytes = 0, raw = ''; const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    bytes += value.byteLength;
    if (bytes > 262144) { await reader.cancel(); throw new AIError('AI response exceeded the size limit.'); }
    raw += decoder.decode(value, { stream: true });
  }
  let data: any;
  try { data = JSON.parse(raw + decoder.decode()); } catch { throw new AIError('AI provider returned invalid JSON.'); }
  let text: unknown;
  if (config.provider === 'gemini') text = data.candidates?.[0]?.content?.parts?.filter((p: any) => !p.thought && typeof p.text === 'string').map((p: any) => p.text).join('');
  else if (config.provider === 'anthropic') text = data.content?.filter((p: any) => p.type === 'text' && typeof p.text === 'string').map((p: any) => p.text).join('');
  else text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new AIError('No text reply returned. The model may require different settings or a larger output budget.');
  return text.trim().slice(0, 3500);
}
