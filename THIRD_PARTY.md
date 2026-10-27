# Dependencies and references

The application source in this repository is released under MIT. Third-party packages retain their own licenses; they are installed from the pinned package lock, not vendored here.

- [baileyrs](https://github.com/oxidezap/baileyrs): MIT. Provides the WhatsApp protocol implementation and runtime-neutral host API.
- `@oxidezap/whatsapp-rust-bridge`: installed through baileyrs. The generated WASM file is copied from the installed dependency at build time and is not committed.
- [qrcode](https://github.com/soldair/node-qrcode): MIT. Generates pairing QR images without a third-party QR service.
- Cloudflare Workers tooling and type packages: see their installed LICENSE files.

The [baileyrs Cloudflare example](https://github.com/oxidezap/baileyrs-cloudflare-example) informed investigation of this architecture. Its source was not imported into this public release; the Worker controller, SQL persistence adapter, setup page and runtime checks were implemented separately. This does not grant a license to that example.

This project is not affiliated with or endorsed by WhatsApp, Meta, Cloudflare or any AI provider.
