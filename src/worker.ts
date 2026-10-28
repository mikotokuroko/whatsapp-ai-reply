import { downloadImage } from './images';
import { DurableObject } from 'cloudflare:workers';
import makeSocket, { createAuthenticationState, setLoggerSink } from '@oxidezap/baileyrs/host';
import type { HostWASocket, HostBaileysEventMap } from '@oxidezap/baileyrs/host';
import { initSync } from '@oxidezap/whatsapp-rust-bridge/host';
import wasm from './bridge.wasm';
import QRCode from 'qrcode';
import { validateConfig, publicConfig, InputError, type Config } from './settings';
import { generate, AIError } from './ai';
import { acceptMessage, Conversations, type Accepted } from './messages';
import { BotStorage } from './storage';
import { page } from './page';

export interface Env { REPLY_BOT: DurableObjectNamespace<ReplyBot>; ADMIN_TOKEN: string }
type RunState = { running: boolean; enabled: boolean; blocked: boolean; retryAfter: number; pairingDeadline: number };
const initial = (): RunState => ({ running: false, enabled: false, blocked: false, retryAfter: 0, pairingDeadline: 0 });
type Usage = { day: string; attempts: number; contacts: Record<string, number>; tests: number; testAt: number };
const day = () => new Date().toISOString().substring(0, 10);
setLoggerSink((_line, done) => done?.());

export class ReplyBot extends DurableObject<Env> {
  private config?: Config;
  private mode = initial();
  private db: BotStorage;
  private socket?: HostWASocket;
  private boot?: Promise<void>;
  private phase = 'stopped';
  private qr?: string;
  private liveSince = Infinity;
  private generation = 0;
  private conversations = new Conversations();
  private mutations = Promise.resolve();
  private messages = Promise.resolve();
  private queued = 0;
  private lastEvent = 'Ready to configure';
  private testBusy = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = new BotStorage(ctx.storage);
    ctx.blockConcurrencyWhile(async () => {
      this.config = await ctx.storage.get<Config>('config');
      this.mode = await ctx.storage.get<RunState>('mode') ?? initial();
      this.phase = this.mode.blocked ? 'needs_attention' : 'stopped';
    });
  }
  private async persist(next: RunState) {
    await this.ctx.storage.put('mode', next);
    this.mode = next;
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const task = this.mutations.then(action);
    this.mutations = task.then(() => {}, () => {});
    return task;
  }
  private async usage(): Promise<Usage> {
    const saved = await this.ctx.storage.get<Usage>('usage');
    return saved?.day === day() ? saved : { day: day(), attempts: 0, contacts: {}, tests: 0, testAt: 0 };
  }
  async status() {
    const usage = await this.usage();
    return { state: this.phase, enabled: this.mode.enabled, settings: publicConfig(this.config), usage: { day: usage.day, attempts: usage.attempts, tests: usage.tests, remaining: Math.max(0, (this.config?.dailyLimit ?? 30) - usage.attempts) }, lastEvent: this.lastEvent,
      qrSvg: this.qr ? await QRCode.toString(this.qr, { type: 'svg', margin: 2 }) : null };
  }
  async command(action: string, input: unknown) {
    return this.serialize(async () => {
      if (action === 'settings') {
        const config = validateConfig(input, this.config);
        await this.ctx.storage.put('config', config);
        this.config = config;
        this.generation++;
        this.conversations.clear();
        this.lastEvent = 'Settings saved';
        return { ok: true };
      }
      if (action === 'start') {
        if (!this.config) throw new InputError('Save AI and contact settings first.');
        if (this.mode.blocked) throw new InputError('Unlink this device in WhatsApp, then reset its saved connection before pairing again.');
        await this.persist({ ...this.mode, running: true, pairingDeadline: Date.now() + 300000 });
        await this.ctx.storage.setAlarm(Date.now() + 60000);
        await this.ensureConnection(true);
      } else if (action === 'enable') {
        if (!this.config || this.phase !== 'connected') throw new InputError('Connect WhatsApp before enabling replies.');
        this.liveSince = Date.now();
        await this.persist({ ...this.mode, enabled: true });
      } else if (['pause', 'stop', 'reset'].includes(action)) {
        this.generation++;
        this.conversations.clear();
        await this.persist({ ...this.mode, enabled: false, running: action === 'pause' && this.mode.running });
        if (action !== 'pause') {
          await this.ctx.storage.deleteAlarm();
          await this.boot;
          const socket = this.socket;
          this.socket = undefined;
          this.liveSince = Infinity;
          await socket?.end();
          this.qr = undefined;
          this.phase = 'stopped';
        }
        if (action === 'reset') { this.db.forgetAuth(); await this.persist(initial()); }
      } else if (action === 'clear-memory') this.conversations.clear();
      else throw new InputError('Unknown action.');
      return { ok: true };
    });
  }
  async testAI() {
    // Reserve quota under the same short mutation queue as other usage writes.
    if (this.testBusy) throw new InputError('An AI test is already running.');
    this.testBusy = true;
    try {
      const config = await this.serialize(async () => {
        if (!this.config) throw new InputError('Save settings first.');
        const usage = await this.usage();
        if (usage.tests >= 10 || Date.now() - usage.testAt < 10000) throw new InputError('AI tests are limited to 10 per UTC day and one every 10 seconds.');
        usage.tests++; usage.testAt = Date.now();
        await this.ctx.storage.put('usage', usage);
        return this.config;
      });
      await generate({ ...config, instructions: 'Reply with the word OK.' }, [{ role: 'user', content: 'Connection test. Reply OK.' }], fetch, true);
      return { ok: true, message: 'AI connection succeeded. No WhatsApp message was sent.' };
    } finally { this.testBusy = false; }
  }
  async alarm() {
    if (!this.mode.running || this.mode.blocked) return;
    await this.ctx.storage.setAlarm(Date.now() + 60000);
    this.db.prune();
    if (this.qr && Date.now() > this.mode.pairingDeadline) { await this.command('stop', {}); return; }
    await this.ensureConnection(false);
  }
  private ensureConnection(pair: boolean): Promise<void> {
    if (this.boot) return this.boot;
    if (this.socket || !this.mode.running || this.mode.blocked || this.mode.retryAfter > Date.now()) return Promise.resolve();
    const task = this.open(pair).catch(async () => {
      this.lastEvent = 'Connection could not start; retry scheduled';
      this.phase = 'closed';
      await this.persist({ ...this.mode, retryAfter: Date.now() + 300000 });
    });
    this.boot = task;
    return task.finally(() => { if (this.boot === task) this.boot = undefined; });
  }
  private async open(pair: boolean) {
    initSync({ module: wasm });
    const auth = await createAuthenticationState(this.db.auth());
    if (!this.mode.running) return;
    if (!auth.creds.registered && !pair) {
      this.phase = 'needs_pairing';
      await this.persist({ ...this.mode, running: false, enabled: false });
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const socket = makeSocket({ auth, version: [2, 3000, 1043857760], shouldSyncHistoryMessage: () => false });
    this.socket = socket;
    this.phase = 'connecting';
    socket.ev.on('connection.update', update => {
      this.ctx.waitUntil(this.serialize(() => this.connectionChanged(socket, update)).catch(() => { this.lastEvent = 'Could not save connection state'; }));
    });
    socket.ev.on('messages.upsert', event => {
      if (event.type !== 'notify' || !this.config || !this.ready(socket)) return;
      for (const message of event.messages) {
        const accepted = acceptMessage(message, this.config.contacts, this.liveSince);
        if (!accepted) continue;
        if (this.queued >= 5) { this.lastEvent = 'Message skipped: reply queue is full'; continue; }
        const generation = this.generation;
        this.queued++;
        this.messages = this.messages.then(() => this.respond(socket, accepted, generation)).catch(() => { this.lastEvent = 'Send failed; not automatically resent'; }).finally(() => { this.queued--; });
        this.ctx.waitUntil(this.messages);
      }
    });
  }
  private async connectionChanged(socket: HostWASocket, update: HostBaileysEventMap['connection.update']) {
    if (socket !== this.socket) return;
    if (update.qr) { this.qr = update.qr; this.phase = 'waiting_for_qr'; }
    if (update.connection === 'open') {
      this.phase = 'connected'; this.qr = undefined; this.liveSince = Date.now();
      await this.persist({ ...this.mode, retryAfter: 0, pairingDeadline: 0 });
    } else if (update.connection === 'connecting') { this.phase = 'connecting'; this.liveSince = Infinity; }
    else if (update.connection === 'close') {
      this.socket = undefined; this.qr = undefined; this.liveSince = Infinity;
      const error = update.lastDisconnect?.error as { output?: { statusCode?: number }; data?: { expire?: number } } | undefined;
      const code = error?.output?.statusCode;
      const blocked = code === 401 || code === 405 || code === 440;
      this.phase = blocked ? 'needs_attention' : 'closed';
      const delay = code === 403 ? Math.max(Date.now() + 3600000, (error?.data?.expire ?? 0) * 1000) : Date.now() + 60000;
      await this.persist({ ...this.mode, blocked, running: !blocked && this.mode.running, enabled: !blocked && this.mode.enabled, retryAfter: delay });
      if (blocked) await this.ctx.storage.deleteAlarm();
    }
  }
  private ready(socket: HostWASocket) { return this.socket === socket && this.phase === 'connected' && this.mode.enabled; }
  private async respond(socket: HostWASocket, item: Accepted, generation: number) {
    const valid = () => this.ready(socket) && generation === this.generation;
    if (!valid() || !this.config) return;
    const config = this.config;
    const reserved = await this.serialize(async () => {
      if (!valid()) return false;
      const usage = await this.usage();
      if (usage.attempts >= config.dailyLimit) { this.lastEvent = 'Message skipped: daily reply limit reached (resets 00:00 UTC)'; return false; }
      if (Date.now() - (usage.contacts[item.contact] ?? 0) < config.cooldownSeconds * 1000) { this.lastEvent = 'Message skipped: contact cooldown'; return false; }
      if (!this.db.claim(item.claim)) return false;
      usage.attempts++; usage.contacts[item.contact] = Date.now();
      await this.ctx.storage.put('usage', usage);
      return true;
    });
    if (!reserved || !valid()) return;
    const context = config.memory ? this.conversations.read(item.contact) : [];
    let text: string;
    try {
      const image = item.image ? await downloadImage(socket, item.image) : undefined;
      if (!valid()) return;
      text = await generate(config, [...context, { role: 'user', content: item.text, image }]);
    }
    catch (error) { this.lastEvent = error instanceof AIError ? error.message : 'Image download or AI reply failed'; return; }
    if (!valid()) return;
    await socket.sendMessage(item.recipient, { text: '🤖 ' + text });
    this.lastEvent = 'Reply sent at ' + new Date().toISOString();
    if (config.memory && valid()) this.conversations.append(item.contact, (item.image ? "[Photo, not retained] " : "") + item.text, text);
  }
}

const securityHeaders = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
export default {
  async fetch(request: Request, env: Env) {
    const path = new URL(request.url).pathname;
    if (path === '/' && request.method === 'GET') return new Response(page, { headers: { ...securityHeaders, 'content-type': 'text/html; charset=utf-8' } });
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers: securityHeaders });
    if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32 || request.headers.get('authorization') !== 'Bearer ' + env.ADMIN_TOKEN) return json({ error: 'Unlock with the setup password.' }, 401);
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return json({ error: 'Cross-origin request denied.' }, 403);
    const bot = env.REPLY_BOT.getByName('account');
    try {
      if (request.method === 'GET' && path === '/api/status') return json(await bot.status());
      if (request.method !== 'POST') return json({ error: 'Not found' }, 404);
      // Enforce a streaming body bound, including clients that omit Content-Length.
      const reader = request.body?.getReader(); let size = 0, text = ''; const decoder = new TextDecoder();
      if (reader) for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 32768) { await reader.cancel(); return json({ error: 'Settings too large' }, 413); } text += decoder.decode(value, { stream: true }); }
      let input: unknown;
      try { input = JSON.parse(text + decoder.decode() || '{}'); } catch { return json({ error: 'Invalid JSON' }, 400); }
      if (path === '/api/test') return json(await bot.testAI());
      return json(await bot.command(path.replace(/^\/api\//, ''), input));
    } catch (error) {
      // RPC preserves Error names, but not necessarily instanceof identity.
      if (error instanceof Error && ['InputError', 'AIError'].includes(error.name)) return json({ error: error.message }, 400);
      return json({ error: 'Operation failed. Check your settings and connection.' }, 503);
    }
  },
} satisfies ExportedHandler<Env>;
