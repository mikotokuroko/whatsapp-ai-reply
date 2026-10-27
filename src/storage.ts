import type { HostStoreCallbacks } from '@oxidezap/baileyrs/host';
export class BotStorage {
  constructor(private storage: DurableObjectStorage) {
    storage.sql.exec('CREATE TABLE IF NOT EXISTS wa_records (bucket TEXT NOT NULL, name TEXT NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(bucket,name))');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, at INTEGER NOT NULL)');
  }
  auth(): HostStoreCallbacks {
    const sql = this.storage.sql;
    return {
      get: async (bucket, name) => {
        const row = sql.exec<{ bytes: ArrayBuffer }>('SELECT bytes FROM wa_records WHERE bucket=? AND name=?', bucket, name).toArray()[0];
        return row ? new Uint8Array(row.bytes) : null;
      },
      set: async (bucket, name, bytes) => { sql.exec('INSERT OR REPLACE INTO wa_records VALUES (?,?,?)', bucket, name, bytes); },
      delete: async (bucket, name) => { sql.exec('DELETE FROM wa_records WHERE bucket=? AND name=?', bucket, name); },
      listKeys: async (bucket, prefix = '') => sql.exec<{ name: string }>('SELECT name FROM wa_records WHERE bucket=? AND substr(name,1,?)=? ORDER BY name', bucket, prefix.length, prefix).toArray().map(row => row.name),
    };
  }
  claim(id: string, now = Date.now()) {
    return this.storage.sql.exec('INSERT OR IGNORE INTO deliveries VALUES (?,?) RETURNING id', id, now).toArray().length === 1;
  }
  prune() { this.storage.sql.exec('DELETE FROM deliveries WHERE at < ?', Date.now() - 2 * 86400000); }
  forgetAuth() { this.storage.sql.exec('DELETE FROM wa_records'); }
}
