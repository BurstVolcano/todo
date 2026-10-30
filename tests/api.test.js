import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';

async function start(dbPath = ':memory:') {
  const app = createApp({ dbPath });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    client() {
      let cookie = '';
      return async (path, { method = 'GET', body, headers = {} } = {}) => {
        const response = await fetch(`${base}${path}`, {
          method,
          headers: {
            ...(cookie ? { cookie } : {}),
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
            ...headers,
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        const nextCookie = response.headers.get('set-cookie');
        if (nextCookie) cookie = nextCookie.split(';')[0];
        const text = await response.text();
        return { status: response.status, headers: response.headers, data: text ? JSON.parse(text) : null };
      };
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      app.locals.close();
    },
  };
}

const password = 'Correct-horse-battery-42';
const exampleTask = {
  title: 'Prepare the project launch',
  description: 'Review the checklist and share the final assets.',
  status: 'In Progress',
  tags: ['Launch', 'Design'],
  dueDate: '2030-06-15',
  priority: 'High',
  list: 'Work',
};

async function register(client, email, name = 'Test Member') {
  const result = await client('/api/auth/register', { method: 'POST', body: { email, name, password } });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.user;
}

test('authentication is required, and guest workspaces are isolated and idempotent', async t => {
  const app = await start();
  t.after(() => app.close());
  const alice = app.client();
  const bob = app.client();
  assert.equal((await alice('/api/auth/me')).status, 401);
  assert.equal((await alice('/api/tasks')).status, 401);
  assert.equal((await alice('/api/tasks', { method: 'POST', body: exampleTask })).status, 401);
  const guest = await alice('/api/auth/guest', { method: 'POST' });
  assert.ok([200, 201].includes(guest.status));
  assert.equal(guest.data.user.isGuest, true);
  assert.match(guest.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(guest.headers.get('set-cookie'), /SameSite=Lax/i);
  const again = await alice('/api/auth/guest', { method: 'POST' });
  assert.equal(again.data.user.id, guest.data.user.id);
  const aliceTasks = await alice('/api/tasks');
  assert.equal(aliceTasks.status, 200);
  assert.ok(aliceTasks.data.tasks.length > 0, 'The guest workspace includes useful sample tasks');
  await bob('/api/auth/guest', { method: 'POST' });
  const bobTasks = await bob('/api/tasks');
  assert.ok(bobTasks.data.tasks.length > 0);
  assert.ok(bobTasks.data.tasks.every(task => !aliceTasks.data.tasks.some(other => other.id === task.id)));
});

test('registration upgrades a guest, preserves tasks, and supports logout and password login', async t => {
  const app = await start();
  t.after(() => app.close());
  const client = app.client();
  const guest = await client('/api/auth/guest', { method: 'POST' });
  const before = await client('/api/tasks');
  const user = await register(client, 'member@example.com', 'Alex Rivera');
  assert.equal(user.id, guest.data.user.id);
  assert.equal(user.isGuest, false);
  assert.equal(user.name, 'Alex Rivera');
  assert.equal(user.email, 'member@example.com');
  assert.equal('password' in user, false);
  assert.equal('passwordHash' in user, false);
  assert.deepEqual((await client('/api/tasks')).data.tasks.map(task => task.id).sort(), before.data.tasks.map(task => task.id).sort());
  assert.equal((await client('/api/auth/logout', { method: 'POST' })).status, 204);
  assert.equal((await client('/api/auth/me')).status, 401);
  assert.equal((await client('/api/auth/login', { method: 'POST', body: { email: 'member@example.com', password: 'incorrect' } })).status, 401);
  const login = await client('/api/auth/login', { method: 'POST', body: { email: 'member@example.com', password } });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.id, user.id);
  assert.equal((await client('/api/auth/me')).data.user.id, user.id);
});

test('tasks support creation, partial updates, completion, and deletion', async t => {
  const app = await start();
  t.after(() => app.close());
  const client = app.client();
  await register(client, 'crud@example.com');
  const created = await client('/api/tasks', { method: 'POST', body: exampleTask });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const task = created.data.task;
  assert.equal(typeof task.id, 'string');
  for (const [key, value] of Object.entries(exampleTask)) assert.deepEqual(task[key], value);
  assert.ok(task.createdAt);
  assert.ok(task.updatedAt);
  const updated = await client(`/api/tasks/${task.id}`, { method: 'PATCH', body: { status: 'Completed', dueDate: null, tags: ['Shipped'] } });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.task.status, 'Completed');
  assert.equal(updated.data.task.title, exampleTask.title);
  assert.equal(updated.data.task.dueDate, null);
  assert.deepEqual(updated.data.task.tags, ['Shipped']);
  assert.equal((await client('/api/tasks')).data.tasks.find(item => item.id === task.id).status, 'Completed');
  assert.equal((await client(`/api/tasks/${task.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await client('/api/tasks')).data.tasks.some(item => item.id === task.id), false);
  assert.equal((await client(`/api/tasks/${task.id}`, { method: 'PATCH', body: { status: 'Pending' } })).status, 404);
});

test('users cannot read, modify, or delete another user’s tasks', async t => {
  const app = await start();
  t.after(() => app.close());
  const owner = app.client();
  const stranger = app.client();
  await register(owner, 'owner@example.com');
  await register(stranger, 'stranger@example.com');
  const { data: { task } } = await owner('/api/tasks', { method: 'POST', body: exampleTask });
  assert.equal((await stranger('/api/tasks')).data.tasks.some(item => item.id === task.id), false);
  assert.equal((await stranger(`/api/tasks/${task.id}`, { method: 'PATCH', body: { title: 'Hijacked' } })).status, 404);
  assert.equal((await stranger(`/api/tasks/${task.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await owner('/api/tasks')).data.tasks.find(item => item.id === task.id).title, exampleTask.title);
});

test('invalid task data and account credentials are rejected without creating records', async t => {
  const app = await start();
  t.after(() => app.close());
  const client = app.client();
  const invalidAccount = await client('/api/auth/register', { method: 'POST', body: { name: 'Alex', email: 'not-an-email', password: 'short' } });
  assert.equal(invalidAccount.status, 400);
  await register(client, 'validation@example.com');
  for (const fields of [
    { title: '  ' },
    { status: 'Finished' },
    { priority: 'Urgent' },
    { dueDate: '2030-02-30' },
    { dueDate: 'tomorrow' },
    { tags: 'Work' },
    { tags: [42] },
  ]) {
    const result = await client('/api/tasks', { method: 'POST', body: { ...exampleTask, ...fields } });
    assert.equal(result.status, 400, `${JSON.stringify(fields)}: ${JSON.stringify(result.data)}`);
    assert.equal(typeof result.data.error, 'string');
  }
  assert.deepEqual((await client('/api/tasks')).data.tasks, []);
  const duplicate = await app.client()('/api/auth/register', { method: 'POST', body: { name: 'Other', email: 'validation@example.com', password } });
  assert.equal(duplicate.status, 409);
});

test('cross-origin mutations are rejected', async t => {
  const app = await start();
  t.after(() => app.close());
  const client = app.client();
  await register(client, 'origin@example.com');
  const response = await client('/api/tasks', { method: 'POST', headers: { origin: 'https://attacker.example' }, body: exampleTask });
  assert.equal(response.status, 403);
  assert.deepEqual((await client('/api/tasks')).data.tasks, []);
});

test('accounts and tasks persist after the database is reopened', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'daylight-api-'));
  const database = join(directory, 'tasks.sqlite');
  let app = await start(database);
  t.after(async () => {
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const client = app.client();
  await register(client, 'persistent@example.com');
  const created = await client('/api/tasks', { method: 'POST', body: exampleTask });
  assert.equal(created.status, 201);
  const taskId = created.data.task.id;
  await app.close();
  app = null;
  app = await start(database);
  const returning = app.client();
  const login = await returning('/api/auth/login', { method: 'POST', body: { email: 'persistent@example.com', password } });
  assert.equal(login.status, 200);
  const saved = (await returning('/api/tasks')).data.tasks.find(task => task.id === taskId);
  assert.ok(saved, 'A task saved before restart is still present');
  for (const [key, value] of Object.entries(exampleTask)) assert.deepEqual(saved[key], value);
});
