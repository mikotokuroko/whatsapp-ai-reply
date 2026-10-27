import type { Message } from './ai';
export interface Envelope {
  key: { id?: string | null; remoteJid?: string | null; remoteJidAlt?: string | null; fromMe?: boolean | null };
  messageTimestamp?: unknown; message?: any;
}
export interface Accepted { recipient: string; contact: string; claim: string; text: string }
export function acceptMessage(message: Envelope, contacts: string[], connectedAt: number, now = Date.now()): Accepted | undefined {
  const { key } = message;
  const jid = key.remoteJid || '';
  if (key.fromMe || !key.id || key.id.length > 256 || !/^\d+@(s\.whatsapp\.net|lid)$/.test(jid)) return;
  const numberJid = jid.endsWith('@lid') ? key.remoteJidAlt : jid;
  const contact = contacts.find(n => n.substring(1) + '@s.whatsapp.net' === numberJid);
  if (!contact) return;
  const sentAt = Number(message.messageTimestamp) * 1000;
  if (!Number.isFinite(sentAt) || sentAt < connectedAt || now - sentAt > 120000 || sentAt > now + 60000) return;
  const body = message.message?.ephemeralMessage?.message ?? message.message;
  const text = body?.conversation ?? body?.extendedTextMessage?.text;
  if (typeof text !== 'string' || !text.trim() || text.length > 4000) return;
  return { recipient: jid, contact, claim: JSON.stringify([contact, key.id]), text: text.trim() };
}
export class Conversations {
  private entries = new Map<string, { at: number; messages: Message[] }>();
  read(contact: string, now = Date.now()): Message[] {
    const entry = this.entries.get(contact);
    if (!entry || now - entry.at > 30 * 60000) { this.entries.delete(contact); return []; }
    return entry.messages;
  }
  append(contact: string, user: string, assistant: string, now = Date.now()) {
    this.entries.set(contact, { at: now, messages: [...this.read(contact, now), { role: 'user' as const, content: user }, { role: 'assistant' as const, content: assistant }].slice(-8) });
  }
  clear() { this.entries.clear(); }
}
