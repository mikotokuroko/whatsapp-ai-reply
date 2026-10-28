import { expect, it, vi } from 'vitest';
import { downloadImage, photo, imageLimit } from '../src/images';
const imageMessage = { mimetype: 'image/jpeg', fileLength: 3, caption: 'What is this?' };
const message = { message: { imageMessage } };
it('accepts ordinary small photos but excludes view-once, unknown size and unsupported formats', () => {
 expect(photo(message.message)).toBe(true);
 for (const change of [{viewOnce:true},{fileLength:0},{fileLength:imageLimit+1},{fileLength:undefined},{mimetype:'image/gif'}]) expect(photo({imageMessage:{...imageMessage,...change}})).toBe(false);
 expect(photo({viewOnceMessage:{message:message.message}})).toBe(false);
});
it('reads a bounded decrypted stream and encodes it without storing it', async () => {
 const downloadMedia = vi.fn().mockResolvedValue(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]));c.close();}}));
 expect(await downloadImage({downloadMedia},message)).toEqual({mimeType:'image/jpeg',data:'AQID'});
 expect(downloadMedia).toHaveBeenCalledWith(message,'stream');
});
it('cancels oversized downloads and rejects incomplete images', async () => {
 const cancel=vi.fn();
 const downloadMedia=vi.fn().mockResolvedValue(new ReadableStream({start(c){c.enqueue(new Uint8Array(imageLimit+1));},cancel}));
 await expect(downloadImage({downloadMedia},message)).rejects.toThrow('too large');expect(cancel).toHaveBeenCalled();
 downloadMedia.mockResolvedValue(new ReadableStream({start(c){c.close();}}));
 await expect(downloadImage({downloadMedia},message)).rejects.toThrow('Incomplete');
});
it('cancels stalled image streams', async () => {
 vi.useFakeTimers();
 try {
  const cancel=vi.fn();const task=downloadImage({downloadMedia:async()=>new ReadableStream({cancel})},message);
  const rejected=expect(task).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(20001);await rejected;expect(cancel).toHaveBeenCalled();
 } finally {vi.useRealTimers();}
});
