import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCallback);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const statuses = new Set(['Pending', 'In Progress', 'Completed']);
const priorities = new Set(['Low', 'Medium', 'High']);
const cookieName = 'taskflow_session';
const sessionLifetime = 30 * 24 * 60 * 60 * 1000;

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, isGuest: Boolean(row.is_guest) };
}

function publicTask(row) {
  return {
    id: row.id, title: row.title, description: row.description, status: row.status,
    tags: JSON.parse(row.tags), dueDate: row.due_date, priority: row.priority,
    list: row.list, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('A JSON object is required.');
}

function text(value, field, max, required = false) {
  if (typeof value !== 'string') fail(`${field} must be text.`);
  const normalized = value.trim();
  if (required && !normalized) fail(`${field} is required.`);
  if (normalized.length > max) fail(`${field} must be at most ${max} characters.`);
  return normalized;
}

function taskInput(body, partial = false) {
  requireObject(body);
  const allowed = new Set(['title', 'description', 'status', 'tags', 'dueDate', 'priority', 'list']);
  if (Object.keys(body).some(key => !allowed.has(key))) fail('Unknown task field.');
  const result = partial ? {} : { description: '', status: 'Pending', tags: [], dueDate: null, priority: 'Medium', list: 'Personal' };
  if (!partial || 'title' in body) result.title = text(body.title, 'Title', 200, true);
  if ('description' in body) result.description = text(body.description, 'Description', 5000);
  if ('list' in body) result.list = text(body.list, 'List', 60, true);
  if ('status' in body) {
    if (!statuses.has(body.status)) fail('Choose Pending, In Progress, or Completed.');
    result.status = body.status;
  }
  if ('priority' in body) {
    if (!priorities.has(body.priority)) fail('Choose Low, Medium, or High priority.');
    result.priority = body.priority;
  }
  if ('tags' in body) {
    if (!Array.isArray(body.tags) || body.tags.length > 10) fail('Use at most 10 tags.');
    result.tags = [...new Set(body.tags.map(tag => text(tag, 'Tag', 30, true)))];
  }
  if ('dueDate' in body) {
    const value = body.dueDate;
    if (value !== null) {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Deadline must be a date in YYYY-MM-DD format.');
      const date = new Date(`${value}T00:00:00.000Z`);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value < '0001-01-01') fail('Deadline must be a valid date.');
    }
    result.dueDate = value;
  }
  return result;
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  const [salt, hash] = encoded.split(':');
  const candidate = await scrypt(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function createApp({ dbPath = process.env.DB_PATH || resolve(root, 'data/taskflow.sqlite'), secureCookies = process.env.COOKIE_SECURE === 'true' } = {}) {
  if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE,
      password_hash TEXT, is_guest INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL,
      tags TEXT NOT NULL, due_date TEXT, priority TEXT NOT NULL,
      list TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tasks_user_id ON tasks(user_id);
  `);
  const app = express();
  app.disable('x-powered-by');
  app.locals.db = db;
  app.locals.close = () => db.close();
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    }
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin) {
      try {
        const parsed = new URL(origin);
        const host = req.headers.host;
        const allowed = (process.env.APP_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean);
        const localDevelopment = process.env.NODE_ENV !== 'production' &&
          ['http://localhost:5173', 'http://127.0.0.1:5173'].includes(origin);
        if (!['http:', 'https:'].includes(parsed.protocol) || (parsed.host !== host && !allowed.includes(origin) && !localDevelopment)) {
          return res.status(403).json({ error: 'Request origin is not allowed.' });
        }
      } catch {
        return res.status(403).json({ error: 'Request origin is not allowed.' });
      }
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', (req, res, next) => {
    const token = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      req.sessionHash = createHash('sha256').update(token).digest('hex');
      req.user = db.prepare('SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ?').get(req.sessionHash, Date.now());
    }
    next();
  });
  const authAttempts = new Map();
  function limitAuth(req, res, next) {
    const now = Date.now();
    const key = req.ip;
    const record = authAttempts.get(key);
    if (record && record.expires > now && record.count >= 40) {
      res.setHeader('Retry-After', Math.ceil((record.expires - now) / 1000));
      return res.status(429).json({ error: 'Too many sign-in attempts. Please try again in a few minutes.' });
    }
    if (!record || record.expires <= now) authAttempts.set(key, { expires: now + 15 * 60 * 1000, count: 1 });
    else record.count++;
    if (authAttempts.size > 10000) for (const [address, entry] of authAttempts) if (entry.expires <= now) authAttempts.delete(address);
    next();
  }
  function setSession(req, res, userId) {
    if (req.sessionHash) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'), userId, Date.now() + sessionLifetime);
    res.cookie(cookieName, token, { httpOnly: true, sameSite: 'lax', secure: secureCookies, maxAge: sessionLifetime, path: '/' });
  }
  function authenticated(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Please sign in to access your tasks.' });
    next();
  }
  const insertTask = db.prepare('INSERT INTO tasks (id,user_id,title,description,status,tags,due_date,priority,list,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  function addTask(userId, input) {
    const now = new Date().toISOString();
    const task = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    insertTask.run(task.id, userId, task.title, task.description, task.status, JSON.stringify(task.tags), task.dueDate, task.priority, task.list, now, now);
    return task;
  }
  function seedTasks(userId) {
    const day = offset => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };
    const samples = [
      { title: 'Map out the next big idea', description: 'Gather inspiration and turn a few rough thoughts into a clear plan.', status: 'In Progress', tags: ['Planning', 'Creative'], dueDate: day(0), priority: 'High', list: 'Work' },
      { title: 'Give the website a fresh look', description: 'Explore a calmer palette and refine the key screens.', status: 'In Progress', tags: ['Design'], dueDate: day(1), priority: 'Medium', list: 'Work' },
      { title: 'Plan a little weekend adventure', description: 'Pick a new trail, invite a friend, and get outside.', status: 'Pending', tags: ['Personal'], dueDate: day(3), priority: 'Low', list: 'Personal' },
      { title: 'Review the project proposal', description: 'Add final feedback before sharing with the team.', status: 'Pending', tags: ['Work', 'Review'], dueDate: day(0), priority: 'High', list: 'Work' },
      { title: 'Make time for a good book', description: 'A few pages and a cup of something warm.', status: 'Pending', tags: ['Wellbeing'], dueDate: null, priority: 'Low', list: 'Personal' },
      { title: 'Clear the desk, clear the mind', description: 'Start the week with a little more room to think.', status: 'Completed', tags: ['Personal'], dueDate: day(-1), priority: 'Medium', list: 'Personal' },
    ];
    for (const task of samples) addTask(userId, task);
  }

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/api/auth/me', authenticated, (req, res) => res.json({ user: publicUser(req.user) }));
  app.post('/api/auth/guest', limitAuth, (req, res) => {
    if (req.user) return res.json({ user: publicUser(req.user) });
    const id = randomUUID();
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO users (id,name,email,password_hash,is_guest,created_at) VALUES (?,?,NULL,NULL,1,?)').run(id, 'Alex', new Date().toISOString());
      seedTasks(id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    setSession(req, res, id);
    res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
  });
  app.post('/api/auth/register', limitAuth, async (req, res) => {
    requireObject(req.body);
    const name = text(req.body.name, 'Name', 80, true);
    const email = text(req.body.email, 'Email', 254, true).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid email address.');
    const password = req.body.password;
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) fail('Password must be between 8 and 128 characters.');
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) fail('An account with this email already exists.', 409);
    const passwordHash = await hashPassword(password);
    const id = req.user?.is_guest ? req.user.id : randomUUID();
    try {
      if (req.user?.is_guest) {
        const result = db.prepare('UPDATE users SET name = ?, email = ?, password_hash = ?, is_guest = 0 WHERE id = ? AND is_guest = 1').run(name, email, passwordHash, id);
        if (!result.changes) fail('This guest workspace has already been registered. Please sign in.', 409);
      }
      else db.prepare('INSERT INTO users (id,name,email,password_hash,is_guest,created_at) VALUES (?,?,?,?,0,?)').run(id, name, email, passwordHash, new Date().toISOString());
    } catch (error) {
      if (error.code?.startsWith('ERR_SQLITE') && db.prepare('SELECT id FROM users WHERE email = ?').get(email)) fail('An account with this email already exists.', 409);
      throw error;
    }
    setSession(req, res, id);
    res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
  });
  app.post('/api/auth/login', limitAuth, async (req, res) => {
    requireObject(req.body);
    const email = text(req.body.email, 'Email', 254, true).toLowerCase();
    const password = req.body.password;
    if (typeof password !== 'string' || password.length > 128) fail('Email or password is incorrect.', 401);
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_guest = 0').get(email);
    // Perform a password derivation even for unknown addresses to reduce timing differences.
    const dummyHash = `${'0'.repeat(32)}:${'0'.repeat(128)}`;
    const valid = await verifyPassword(password, user?.password_hash || dummyHash);
    if (!user || !valid) fail('Email or password is incorrect.', 401);
    setSession(req, res, user.id);
    res.json({ user: publicUser(user) });
  });
  app.post('/api/auth/logout', (req, res) => {
    if (req.sessionHash) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
    res.clearCookie(cookieName, { httpOnly: true, sameSite: 'lax', secure: secureCookies, path: '/' });
    res.status(204).end();
  });
  app.get('/api/tasks', authenticated, (req, res) => {
    res.json({ tasks: db.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC, rowid DESC').all(req.user.id).map(publicTask) });
  });
  app.post('/api/tasks', authenticated, (req, res) => {
    const input = taskInput(req.body);
    res.status(201).json({ task: addTask(req.user.id, input) });
  });
  app.patch('/api/tasks/:id', authenticated, (req, res) => {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!row) fail('Task not found.', 404);
    const changes = taskInput(req.body, true);
    const task = { ...publicTask(row), ...changes, updatedAt: new Date().toISOString() };
    db.prepare('UPDATE tasks SET title = ?, description = ?, status = ?, tags = ?, due_date = ?, priority = ?, list = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(task.title, task.description, task.status, JSON.stringify(task.tags), task.dueDate, task.priority, task.list, task.updatedAt, task.id, req.user.id);
    res.json({ task });
  });
  app.delete('/api/tasks/:id', authenticated, (req, res) => {
    const result = db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (!result.changes) fail('Task not found.', 404);
    res.status(204).end();
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
  const dist = resolve(root, 'dist');
  if (existsSync(resolve(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get('/{*path}', (req, res) => res.sendFile(resolve(dist, 'index.html')));
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong. Please try again.' : error.type === 'entity.parse.failed' ? 'Invalid JSON body.' : error.message });
  });
  return app;
}
