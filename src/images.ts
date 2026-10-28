import { Buffer } from 'node:buffer';
export type ImageInput = { mimeType: string; data: string };
export const imageLimit = 4 * 1024 * 1024;
// Only ordinary photos, never view-once messages, stickers, or documents.
export function photo(body: any): boolean {
  const image = body?.imageMessage;
  const size = Number(image?.fileLength);
  return !!image && ['image/jpeg', 'image/png', 'image/webp'].includes(image.mimetype) &&
    Number.isSafeInteger(size) && size > 0 && size <= imageLimit && !image.viewOnce;
}
export async function downloadImage(socket: { downloadMedia: (...args: unknown[]) => Promise<unknown> }, message: any): Promise<ImageInput> {
  const body = message?.message?.ephemeralMessage?.message ?? message?.message;
  if (!photo(body)) throw new Error('Unsupported image');
  // The host library returns a Web stream, decrypting and verifying WhatsApp media.
  const stream = await socket.downloadMedia(message, 'stream');
  if (!(stream instanceof ReadableStream)) throw new Error('Image stream unavailable');
  const reader = stream.getReader();
  let expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => {}); }, 20000);
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (expired) throw new Error('Image download timed out');
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error('Invalid image stream');
      length += value.byteLength;
      if (length > imageLimit) throw new Error('Image too large');
      chunks.push(value);
    }
    if (!length || length !== Number(body.imageMessage.fileLength)) throw new Error('Incomplete image');
    return { mimeType: body.imageMessage.mimetype, data: Buffer.concat(chunks, length).toString('base64') };
  } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
