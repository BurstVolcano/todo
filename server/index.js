import { createApp } from './app.js';

const app = createApp();
const port = Number(process.env.PORT || 3001);
const server = app.listen(port, '0.0.0.0', () => console.log(`Daylight server listening on port ${port}`));

function shutdown() {
  server.close(() => {
    app.locals.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
