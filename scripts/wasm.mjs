import { copyFile } from 'node:fs/promises';
await copyFile(new URL('../node_modules/@oxidezap/whatsapp-rust-bridge/dist/whatsapp_rust_bridge_bg.wasm', import.meta.url), new URL('../src/bridge.wasm', import.meta.url));
