import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserStore, SaveConflict } from '../src/persistence.ts';
import { SAMPLE } from '../src/core.ts';

test('browser storage persists revisions, atomically rejects a competing tab, and retains history on restore', async () => {
  const tabA = await browserStore();
  const tabB = await browserStore();
  assert.equal(await tabA.get(), null);
  const first = await tabA.save(SAMPLE, 0);
  assert.equal((await tabB.get())?.revision, 1);
  const competing = await Promise.allSettled([
    tabA.save({ ...SAMPLE, name: 'First tab' }, 1),
    tabB.save({ ...SAMPLE, name: 'Second tab' }, 1),
  ]);
  assert.equal(competing.filter(({ status }) => status === 'fulfilled').length, 1);
  const rejected = competing.find(({ status }) => status === 'rejected') as PromiseRejectedResult;
  assert(rejected.reason instanceof SaveConflict);
  assert.equal((await tabB.get())?.revision, 2);
  const restored = await tabB.save(first, 2);
  assert.equal(restored.revision, 3);
  assert.deepEqual(
    (await tabA.history()).map(({ revision }) => revision),
    [3, 2, 1],
  );
  assert.equal((await tabA.get(1))?.name, SAMPLE.name);
  assert.equal((await tabA.get(2))?.name, 'First tab');
  assert.equal((await tabA.get(3))?.name, SAMPLE.name);
  assert.equal(await tabA.get(99), null);
});
