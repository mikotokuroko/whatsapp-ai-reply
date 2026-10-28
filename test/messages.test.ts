import { expect, it } from 'vitest';
import { acceptMessage, Conversations } from '../src/messages';
const now=Date.now(), contacts=['+14155550123','+442079460123'];
const incoming={key:{id:'one',remoteJid:'14155550123@s.whatsapp.net'},messageTimestamp:Math.ceil(now/1000),message:{conversation:'Hi'}};
it('requires an allowed direct contact and a fresh text message',()=>{
 expect(acceptMessage(incoming,contacts,now-1000,now)?.contact).toBe(contacts[0]);
 expect(acceptMessage({...incoming,key:{...incoming.key,remoteJid:'999@lid',remoteJidAlt:'14155550123@s.whatsapp.net'}},contacts,now-1000,now)).toBeDefined();
 for(const key of [{...incoming.key,remoteJid:'999@lid'},{...incoming.key,remoteJid:'123@g.us'},{...incoming.key,fromMe:true},{...incoming.key,remoteJid:'999@s.whatsapp.net'}]) expect(acceptMessage({...incoming,key},contacts,now-1000,now)).toBeUndefined();
 expect(acceptMessage({...incoming,messageTimestamp:0},contacts,0,now)).toBeUndefined();
 expect(acceptMessage({...incoming,message:{imageMessage:{caption:'hi'}}},contacts,0,now)).toBeUndefined();
});
it('keeps contact memories separate, bounded and expiring',()=>{
 const c=new Conversations();c.append('one','private','answer',now);
 expect(c.read('two',now)).toEqual([]);expect(c.read('one',now)).toHaveLength(2);
 for(let i=0;i<10;i++)c.append('one','hi','reply',now);
 expect(c.read('one',now)).toHaveLength(8);expect(c.read('one',now+1800001)).toEqual([]);
 c.append('two','x','y');c.clear();expect(c.read('two')).toEqual([]);
});

it('allows captioned and captionless photos only from fresh allowed contacts',()=>{
 const message={...incoming,message:{imageMessage:{mimetype:'image/jpeg',fileLength:123,caption:'Read this'}}};
 expect(acceptMessage(message,contacts,now-1000,now)?.text).toBe('Read this');
 expect(acceptMessage(message,contacts,now-1000,now)?.image).toBe(message);
 expect(acceptMessage(message,[],now-1000,now)).toBeUndefined();
 expect(acceptMessage({...message,messageTimestamp:0},contacts,0,now)).toBeUndefined();
 expect(acceptMessage({...message,message:{imageMessage:{mimetype:'image/jpeg',fileLength:123}}},contacts,now-1000,now)?.text).toContain('Describe');
});
