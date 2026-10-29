import test from 'node:test';
import assert from 'node:assert/strict';
import { saveProject, listProjects, getProject, deleteProject } from '../src/services/storage.js';

function local(raw = null) {
  const values = new Map(raw === null ? [] : [['assured_projects', raw]]);
  globalThis.window = {};
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  return values;
}

test('local fallback saves, retrieves, updates and deletes without duplicating projects', async () => {
  local();
  await saveProject({ id: 'a', name: 'First' });
  await saveProject({ id: 'a', name: 'Renamed' });
  assert.equal((await listProjects()).length, 1);
  assert.equal((await getProject('a')).name, 'Renamed');
  await deleteProject('a');
  assert.deepEqual(await listProjects(), []);
});

test('malformed storage reports an actionable error and is never overwritten by save or delete', async () => {
  for (const raw of ['null', '{}', '{', '[null]', '[{"id":{}}]', '[{"name":"missing ID"}]']) {
    const values = local(raw);
    await assert.rejects(listProjects(), /preserved/);
    await assert.rejects(saveProject({ id: 'new' }), /preserved/);
    await assert.rejects(deleteProject('new'), /preserved/);
    assert.equal(values.get('assured_projects'), raw);
  }
});

test('synchronously blocked IndexedDB falls back to local storage', async () => {
  local();
  window.indexedDB = { open() { throw new Error('Blocked'); } };
  await saveProject({ id: 'fallback' });
  assert.equal((await getProject('fallback')).id, 'fallback');
});

test('unavailable local storage rejects instead of reporting a successful empty collection', async () => {
  local();
  localStorage.getItem = () => { throw new Error('Blocked'); };
  await assert.rejects(listProjects(), /storage is unavailable/);
  await assert.rejects(saveProject({ id: 'a' }), /storage is unavailable/);
});

function abortingDB() {
  local();
  let closed = 0;
  const db = {
    close() { closed++; },
    transaction() {
      const tx = { error: new Error('Transaction aborted'), objectStore: () => ({
        put() {}, delete() {}, get() { return {}; }, getAll() { return {}; },
      }) };
      queueMicrotask(() => tx.onabort?.());
      return tx;
    },
  };
  window.indexedDB = { open() {
    const request = { result: db };
    queueMicrotask(() => request.onsuccess());
    return request;
  } };
  return () => closed;
}

test('aborted writes and list reads settle, report failure, and close their connections', async () => {
  for (const operation of [() => saveProject({ id: 'a' }), () => deleteProject('a'), () => listProjects()]) {
    const closed = abortingDB();
    await assert.rejects(operation(), /Transaction aborted/);
    assert.equal(closed(), 1);
  }
  const closed = abortingDB();
  await assert.rejects(getProject('a'), /Transaction aborted/);
  assert.equal(closed(), 1);
});

test('synchronous transaction and write errors release connections and never report success', async () => {
  for (const failAt of ['transaction', 'put']) {
    local();
    let closed = 0, aborted = 0;
    const db = {
      close() { closed++; },
      transaction() {
        if (failAt === 'transaction') throw new Error('Database unavailable');
        return { abort() { aborted++; }, objectStore() { return { put() { throw new Error('Invalid project'); } }; } };
      },
    };
    window.indexedDB = { open() {
      const req = { result: db };
      queueMicrotask(() => req.onsuccess());
      return req;
    } };
    await assert.rejects(saveProject({ id: 'a' }), /Saving was interrupted/);
    assert.equal(closed, 1);
    assert.equal(aborted, failAt === 'put' ? 1 : 0);
  }
});

test('blocked database open reports recovery steps and closes a late connection', async () => {
  const values = local('[{"id":"existing"}]');
  let request, closed = 0;
  window.indexedDB = { open() {
    request = { result: { close() { closed++; } } };
    queueMicrotask(() => request.onblocked());
    return request;
  } };
  await assert.rejects(saveProject({ id: 'new' }), /Close other Assured tabs/);
  assert.equal(values.get('assured_projects'), '[{"id":"existing"}]');
  request.onsuccess();
  assert.equal(closed, 1);
});

test('a successful request followed by transaction abort is a failed read', async () => {
  local();
  let tx, request;
  window.indexedDB = { open() {
    const open = { result: { close() {}, transaction() {
      tx = { error: new Error('Commit failed'), objectStore() { return { get() { request = { result: { id: 'a' } }; return request; } }; } };
      return tx;
    } } };
    queueMicrotask(() => open.onsuccess());
    return open;
  } };
  const pending = getProject('a');
  await new Promise(resolve => setImmediate(resolve));
  request.onsuccess();
  tx.onabort();
  await assert.rejects(pending, /Commit failed/);
});

test('successful database operations wait for transaction commit', async () => {
  local();
  let tx, closed = 0, settled = false;
  window.indexedDB = { open() {
    const req = { result: { close() { closed++; }, transaction() {
      tx = { objectStore() { return { put() {} }; } };
      return tx;
    } } };
    queueMicrotask(() => req.onsuccess());
    return req;
  } };
  const pending = saveProject({ id: 'a' }).then(value => { settled = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  tx.oncomplete();
  assert.equal((await pending).id, 'a');
  assert.equal(closed, 1);
});

test('local quota failure preserves previous data and reports export recovery', async () => {
  const raw = '[{"id":"existing"}]';
  const values = local(raw);
  localStorage.setItem = () => { throw new Error('Quota exceeded'); };
  await assert.rejects(saveProject({ id: 'new' }), /Export your experiment/);
  await assert.rejects(deleteProject('existing'), /Export your experiment/);
  assert.equal(values.get('assured_projects'), raw);
});

test('invalid project IDs cannot create unreadable local data', async () => {
  const values = local();
  for (const id of [undefined, 1, '', ' ']) await assert.rejects(saveProject({ id }), /valid ID/);
  assert.equal(values.size, 0);
});
