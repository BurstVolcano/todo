import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';

const directory = mkdtempSync(join(tmpdir(), 'daylight-browser-'));
const app = createApp({ dbPath: join(directory, 'test.sqlite'), secureCookies: false });
const server = app.listen(3101, '127.0.0.1');
function close() {
  server.close(() => {
    app.locals.close();
    rmSync(directory, { recursive: true, force: true });
    process.exit(0);
  });
}
process.once('SIGINT', close);
process.once('SIGTERM', close);
