import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AtomicJsonStore } from '../../bridge/atomic-json-store.mjs';
import { createWorkflowControl, WORKFLOW_CONTROL_METHODS } from '../../bridge/workflow-control.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const OWNER_A = 'owner-alpha-00000001';
const OWNER_B = 'owner-beta-000000002';
const SECRET = 'private-token-value';
const REQUEST_ID = 'ecfb1564-4e49-4b25-97fe-e3b712eca0a1';
const LOCAL_PATH = 'C:\\private\\exports\\message.txt';

function demonstrationSteps(label = 'Hello') {
  return [
    { tool: 'prepare_message', role: 'textbox', name: 'Message', parameters: { recipient: 'Alice', text: label, apiToken: SECRET, requestId: REQUEST_ID, outputPath: LOCAL_PATH, headers: { authorization: `Bearer ${SECRET}` } }, preFingerprint: A, postFingerprint: B },
    { tool: 'send_message', role: 'button', name: 'Send', parameters: { recipient: 'Alice', apiToken: SECRET }, preFingerprint: B, postFingerprint: A },
  ];
}

async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tb-workflow-control-'));
  const filePath = path.join(directory, 'state.json');
  const atomicStore = new AtomicJsonStore({ filePath });
  let writes = 0;
  const store = { read: key => atomicStore.read(key), write: (key, value) => { writes += 1; return atomicStore.write(key, value); } };
  let sequence = 0;
  let instant = 1000;
  const options = { store, now: () => instant, idRef: () => `generated-${++sequence}` };
  return { filePath, store, options, control: createWorkflowControl(options), writes: () => writes, setNow: value => { instant = value; } };
}

test('persists owner-bound demonstrations with secret and volatile values replaced by placeholders', async () => {
  const { control, filePath } = await setup();
  const stored = await control.call(WORKFLOW_CONTROL_METHODS.demonstrationsPut, { demonstrationId: 'demo-one', name: 'Send greeting', steps: demonstrationSteps() }, OWNER_A);
  assert.deepEqual(stored, { id: 'demo-one', name: 'Send greeting', revision: 1, createdAt: '1970-01-01T00:00:01.000Z', updatedAt: '1970-01-01T00:00:01.000Z', stepCount: 2 });
  assert.deepEqual(await control.demonstrations.list({}, OWNER_B), []);
  assert.equal((await control.demonstrations.list({}, OWNER_A))[0].id, 'demo-one');

  const adapter = await control.adapter.draft({ adapterId: 'adapter-one', demonstrationId: 'demo-one' }, OWNER_A);
  assert.equal(adapter.enabled, false);
  assert.equal(adapter.version, 1);
  assert.deepEqual(adapter.steps.map(step => step.parameters.recipient), [{ placeholder: 'recipient_1' }, { placeholder: 'recipient_1' }]);
  assert.match(adapter.steps[0].parameters.apiToken.placeholder, /^secret_/u);
  assert.deepEqual(adapter.steps[1].parameters.apiToken, adapter.steps[0].parameters.apiToken);
  assert.match(adapter.steps[0].parameters.requestId.placeholder, /^volatile_/u);
  assert.match(adapter.steps[0].parameters.outputPath.placeholder, /^volatile_/u);
  assert.match(adapter.steps[0].parameters.headers.authorization.placeholder, /^secret_/u);

  const raw = await readFile(filePath, 'utf8');
  for (const privateValue of [OWNER_A, SECRET, REQUEST_ID, LOCAL_PATH]) assert.equal(raw.includes(privateValue), false);
});

test('keeps adapter lookup, toggles, and forgetting bound to the exact owner', async () => {
  const { control, options, setNow } = await setup();
  await control.demonstrations.put({ demonstrationId: 'demo-one', steps: demonstrationSteps() }, OWNER_A);
  await control.adapter.draft({ adapterId: 'adapter-one', demonstrationId: 'demo-one' }, OWNER_A);
  await assert.rejects(control.adapter.version({ adapterId: 'adapter-one' }, OWNER_B), { code: 'WORKFLOW_ADAPTER_NOT_FOUND' });
  assert.deepEqual(await control.demonstrations.forget({ demonstrationId: 'demo-one' }, OWNER_B), { forgotten: false });

  setNow(2000);
  const enabled = await control.adapter.enable({ adapterId: 'adapter-one' }, OWNER_A);
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.version, 2);
  assert.equal((await control.adapter.enable({ adapterId: 'adapter-one' }, OWNER_A)).version, 2);
  setNow(3000);
  const disabled = await control.adapter.disable({ adapterId: 'adapter-one' }, OWNER_A);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.version, 3);

  const restored = createWorkflowControl(options);
  assert.equal((await restored.adapter.version({ adapterId: 'adapter-one' }, OWNER_A)).version, 3);
  assert.deepEqual(await restored.demonstrations.forget({ demonstrationId: 'demo-one' }, OWNER_A), { forgotten: true });
  assert.deepEqual(await restored.demonstrations.list({}, OWNER_A), []);
  assert.equal((await restored.adapter.version({ adapterId: 'adapter-one' }, OWNER_A)).id, 'adapter-one');
});

test('shadow replay is a strict, side-effect-free comparison', async () => {
  const { control, filePath, writes } = await setup();
  await control.demonstrations.put({ demonstrationId: 'demo-one', steps: demonstrationSteps() }, OWNER_A);
  const adapter = await control.adapter.draft({ adapterId: 'adapter-one', demonstrationId: 'demo-one' }, OWNER_A);
  const observations = adapter.steps.map(({ tool, role, name, preFingerprint, postFingerprint }) => ({ tool, role, name, preFingerprint, postFingerprint }));
  const before = await readFile(filePath, 'utf8');
  const writesBefore = writes();

  assert.deepEqual(await control.call(WORKFLOW_CONTROL_METHODS.adapterShadowReplay, { adapterId: 'adapter-one', observations }, OWNER_A), { matched: true, version: 1, mutated: false });
  const drift = structuredClone(observations);
  drift[0].name = 'Different control';
  assert.deepEqual(await control.adapter.shadow_replay({ adapterId: 'adapter-one', observations: drift }, OWNER_A), { matched: false, reason: 'anchor-drift', step: 0, version: 1, mutated: false });
  assert.equal(await readFile(filePath, 'utf8'), before);
  assert.equal(writes(), writesBefore);
  assert.equal((await control.adapter.version({ adapterId: 'adapter-one' }, OWNER_A)).enabled, false);
});

test('serializes concurrent writes and rejects unbounded or unknown input', async () => {
  const { control } = await setup();
  await Promise.all(Array.from({ length: 8 }, (_, index) => control.demonstrations.put({ demonstrationId: `demo-${index}`, steps: demonstrationSteps(String(index)) }, OWNER_A)));
  assert.equal((await control.demonstrations.list({}, OWNER_A)).length, 8);
  await assert.rejects(control.demonstrations.put({ steps: Array.from({ length: 129 }, () => demonstrationSteps()[0]) }, OWNER_A), { code: 'WORKFLOW_STEPS' });
  await assert.rejects(control.demonstrations.put({ steps: demonstrationSteps(), extra: true }, OWNER_A), { code: 'WORKFLOW_INPUT_INVALID' });
  await assert.rejects(control.adapter.version({ adapterId: 'missing' }, 'short-owner'), { code: 'WORKFLOW_OWNER_INVALID' });
});
