import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createWindowsUiaBroker } from '../../bridge/windows-uia.mjs';

function fixture() {
  let time = 0; const calls = [];
  const windows = [{ processId: 10, windowId: 99, name: 'Editor', enabled: true, visible: true, bounds: { x: 1, y: 2, width: 800, height: 600 } }, { processId: 11, windowId: 100, name: 'Hidden', enabled: true, visible: false }];
  const controls = [
    { processId: 10, windowId: 99, runtimeId: '1.2.3', name: 'Save', automationId: 'save', controlType: 'Button', enabled: true, visible: true, supportsInvoke: true, bounds: { x: 2, y: 3, width: 40, height: 20 } },
    { processId: 10, windowId: 99, runtimeId: '1.2.4', name: 'Title', automationId: 'title', controlType: 'Edit', enabled: true, visible: true, supportsSetValue: true },
    { processId: 10, windowId: 99, runtimeId: '1.2.5', name: 'Password', automationId: 'password', controlType: 'Edit', enabled: true, visible: true, supportsSetValue: true, password: true },
  ];
  const adapter = { listWindows: async () => structuredClone(windows), listControls: async () => structuredClone(controls), invoke: async (c) => calls.push(['invoke', c.runtimeId]), setValue: async (c, v) => calls.push(['set', c.runtimeId, v]) };
  const broker = createWindowsUiaBroker({ adapter, now: () => time, handleTtlMs: 100 });
  return { broker, windows, controls, calls, advance: (n) => { time += n; } };
}

test('lists only visible enabled windows and controls with opaque redacted handles', async () => {
  const h = fixture(); const listed = await h.broker.call('windows.list');
  assert.equal(listed.windows.length, 1);
  assert.equal(JSON.stringify(listed).includes('processId'), false);
  assert.equal(JSON.stringify(listed).includes('windowId'), false);
  const controls = await h.broker.call('controls.list', { window: listed.windows[0].handle });
  assert.deepEqual(controls.controls.map((c) => c.name), ['Save', 'Title']);
  assert.equal(JSON.stringify(controls).includes('runtimeId'), false);
  assert.equal(JSON.stringify(controls).includes('password'), false);
});

test('revalidates exact runtime binding before invoke and set value', async () => {
  const h = fixture(); const window = (await h.broker.call('windows.list')).windows[0];
  let controls = (await h.broker.call('controls.list', { window: window.handle })).controls;
  await h.broker.call('control.invoke', { control: controls.find((c) => c.name === 'Save').handle });
  controls = (await h.broker.call('controls.list', { window: window.handle })).controls;
  await h.broker.call('control.set_value', { control: controls.find((c) => c.name === 'Title').handle, value: 'Hello\u0000 world' });
  assert.deepEqual(h.calls, [['invoke', '1.2.3'], ['set', '1.2.4', 'Hello world']]);
});

test('fails closed on handle expiry and process/control drift', async () => {
  const h = fixture(); let window = (await h.broker.call('windows.list')).windows[0]; h.advance(101);
  await assert.rejects(h.broker.call('controls.list', { window: window.handle }), { code: 'UIA_WINDOW_HANDLE_STALE' });
  window = (await h.broker.call('windows.list')).windows[0]; const control = (await h.broker.call('controls.list', { window: window.handle })).controls[0];
  h.controls[0].runtimeId = 'replacement';
  await assert.rejects(h.broker.call('control.invoke', { control: control.handle }), { code: 'UIA_CONTROL_DRIFT' });
});

test('does not accept window or control handles from another local client owner', async () => {
  const h = fixture();
  const window = (await h.broker.call('windows.list', {}, 'owner-alpha')).windows[0];
  await assert.rejects(h.broker.call('controls.list', { window: window.handle }, 'owner-beta'), { code: 'UIA_WINDOW_HANDLE_STALE' });
  const control = (await h.broker.call('controls.list', { window: window.handle }, 'owner-alpha')).controls[0];
  await assert.rejects(h.broker.call('control.invoke', { control: control.handle }, 'owner-beta'), { code: 'UIA_CONTROL_HANDLE_STALE' });
});

test('rejects protected payment OTP and CAPTCHA controls and exposes no bulk tool', async () => {
  const h = fixture();
  h.controls.push({ processId: 10, windowId: 99, runtimeId: '6', name: 'Card number payment', controlType: 'Edit', enabled: true, visible: true, supportsSetValue: true });
  h.controls.push({ processId: 10, windowId: 99, runtimeId: '7', name: 'OTP verification code', controlType: 'Edit', enabled: true, visible: true, supportsSetValue: true });
  h.controls.push({ processId: 10, windowId: 99, runtimeId: '8', name: 'CAPTCHA', controlType: 'Edit', enabled: true, visible: true, supportsSetValue: true });
  const window = (await h.broker.call('windows.list')).windows[0]; const listed = await h.broker.call('controls.list', { window: window.handle });
  assert.deepEqual(listed.controls.map((c) => c.name), ['Save', 'Title']);
  assert.deepEqual(h.broker.descriptors().map((d) => d.name), ['windows.list', 'controls.list', 'control.invoke', 'control.set_value']);
});

test('bounds execution time and redacts adapter failures', async () => {
  const hanging = { listWindows: () => new Promise(() => {}), listControls: async () => [], invoke: async () => {}, setValue: async () => {} };
  const broker = createWindowsUiaBroker({ adapter: hanging, timeoutMs: 10 });
  await assert.rejects(broker.call('windows.list'), (error) => error.code === 'UIA_TIMEOUT' && !error.message.includes('PowerShell'));
  const failing = { ...hanging, listWindows: async () => { throw new Error('C:\\secret\\script.ps1 access denied'); } };
  const redacted = createWindowsUiaBroker({ adapter: failing, timeoutMs: 10 });
  await assert.rejects(redacted.call('windows.list'), (error) => !error.message.includes('secret'));
});

test('real Windows PowerShell adapter parses and returns only the public window schema', { skip: process.platform !== 'win32' }, async () => {
  const listed = await createWindowsUiaBroker().call('windows.list', {}, 'real-adapter-smoke-owner');
  assert.ok(Array.isArray(listed.windows));
  assert.ok(listed.windows.length <= 64);
  for (const window of listed.windows) {
    assert.deepEqual(Object.keys(window).sort(), ['bounds', 'enabled', 'handle', 'name', 'visible']);
    assert.match(window.handle, /^[a-f0-9]{48}$/);
  }
});

test('live UIA sets and invokes only its own fixture and preserves Unicode', {
  skip: process.platform !== 'win32' || process.env.TOOLBRAID_UIA_LIVE !== '1', timeout: 60_000,
}, async () => {
  const title = `ToolBraid UIA fixture ${process.pid}`;
  const script = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName PresentationFramework
$w=New-Object System.Windows.Window
$w.Title='${title}';$w.Width=360;$w.Height=220
$panel=New-Object System.Windows.Controls.StackPanel
$edit=New-Object System.Windows.Controls.TextBox
[System.Windows.Automation.AutomationProperties]::SetName($edit,'Fixture input')
$button=New-Object System.Windows.Controls.Button
$button.Content='Apply fixture'
$result=New-Object System.Windows.Controls.TextBlock
$result.Text='Ready'
$collapsed=New-Object System.Windows.Controls.Button
$collapsed.Content='Collapsed';$collapsed.Visibility='Collapsed'
$button.Add_Click({$result.Text=$edit.Text})
$panel.Children.Add($edit)|Out-Null
$panel.Children.Add($button)|Out-Null
$panel.Children.Add($result)|Out-Null
$panel.Children.Add($collapsed)|Out-Null
$w.Content=$panel
$timer=New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval=[TimeSpan]::FromSeconds(50)
$timer.Add_Tick({$w.Close()});$timer.Start()
$w.ShowDialog()|Out-Null
`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' });
  let launchError;
  child.on('error', (error) => { launchError = error; });
  try {
    const broker = createWindowsUiaBroker();
    let window;
    const deadline = Date.now() + 15_000;
    while (!window && Date.now() < deadline) {
      if (launchError) throw launchError;
      window = (await broker.call('windows.list')).windows.find((item) => item.name === title);
      if (!window) await delay(200);
    }
    assert.ok(window, 'A visible test window is required; an empty desktop is not a live pass.');
    const list = async () => (await broker.call('controls.list', { window: window.handle })).controls;
    let controls = await list();
    const input = controls.find((item) => item.name === 'Fixture input' && item.supportsSetValue);
    assert.ok(input);
    const marker = 'Verificat șțăîâ — UIA';
    await broker.call('control.set_value', { control: input.handle, value: marker });
    controls = await list();
    const button = controls.find((item) => item.name === 'Apply fixture' && item.supportsInvoke);
    assert.ok(button);
    await broker.call('control.invoke', { control: button.handle });
    assert.ok((await list()).some((item) => item.name === marker && item.controlType === 'ControlType.Text'));
  } finally {
    child.kill();
  }
});
