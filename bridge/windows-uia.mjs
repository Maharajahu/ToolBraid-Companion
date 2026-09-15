import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';

const execFileAsync = promisify(execFile);
const HANDLE_TTL_MS = 2 * 60_000;
const MAX_WINDOWS = 64;
const MAX_CONTROLS = 256;
const MAX_TEXT = 4096;
const DEFAULT_TIMEOUT_MS = 10_000;
const BLOCKED = /(?:password|passcode|pin\b|one[- ]?time|otp\b|verification code|security code|captcha|payment|credit card|card number|cvv|cvc|iban)/iu;

export class WindowsUiaError extends Error { constructor(code, message) { super(message); this.name = 'WindowsUiaError'; this.code = code; } }
function fail(code, message) { throw new WindowsUiaError(code, message); }
function clean(value, max = MAX_TEXT) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''; }
function boundedRect(value) {
  const rect = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const key of ['x', 'y', 'width', 'height']) out[key] = Number.isFinite(rect[key]) ? Math.max(-100_000, Math.min(100_000, Math.round(rect[key]))) : 0;
  return Object.freeze(out);
}
function opaque() { return crypto.randomBytes(24).toString('hex'); }
function owner(value = 'local-owner') { if (typeof value !== 'string' || value.length < 8 || value.length > 128) fail('UIA_OWNER_INVALID', 'An internal UI Automation owner is required.'); return value; }
function blocked(control) { return control?.protected === true || control?.password === true || BLOCKED.test(`${control?.name ?? ''} ${control?.automationId ?? ''} ${control?.controlType ?? ''}`); }
function sameWindow(a, b) { return a && b && a.processId === b.processId && String(a.windowId) === String(b.windowId); }
function sameControl(a, b) { return sameWindow(a, b) && String(a.runtimeId) === String(b.runtimeId) && a.controlType === b.controlType; }

export function createPowerShellUiaAdapter({ powershell = 'powershell.exe', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new RangeError('timeoutMs must be 100..30000.');
  async function run(operation, payload = {}) {
    const script = String.raw`
$Operation=$env:TOOLBRAID_UIA_OPERATION;$Payload=$env:TOOLBRAID_UIA_PAYLOAD
$OutputEncoding=[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding
$ErrorActionPreference='Stop'; Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName UIAutomationClientsideProviders
# PowerShell dynamic stack frames can break .NET's first default-proxy initialization.
try { [System.Windows.Automation.ClientSettings]::RegisterClientSideProviders([UIAutomationClientsideProviders.UIAutomationClientSideProviders]::ClientSideProviderDescriptionTable) }
catch {
  if ($_.Exception.InnerException -isnot [NullReferenceException]) { throw }
  [System.Windows.Automation.ClientSettings]::RegisterClientSideProviders([UIAutomationClientsideProviders.UIAutomationClientSideProviders]::ClientSideProviderDescriptionTable)
}
$p=$Payload|ConvertFrom-Json
function Coordinate([double]$v){if([double]::IsNaN($v) -or [double]::IsInfinity($v)){return 0};return [int][Math]::Max(-100000,[Math]::Min(100000,$v))}
function Rect($r){@{x=Coordinate $r.X;y=Coordinate $r.Y;width=Coordinate $r.Width;height=Coordinate $r.Height}}
$root=[System.Windows.Automation.AutomationElement]::RootElement
if($Operation -eq 'windows'){$c=$root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition);@($c|%{@{processId=$_.Current.ProcessId;windowId=$_.Current.NativeWindowHandle;name=$_.Current.Name;enabled=$_.Current.IsEnabled;visible=(-not $_.Current.IsOffscreen);bounds=Rect $_.Current.BoundingRectangle}})|ConvertTo-Json -Compress -Depth 5;exit}
$processCondition=New-Object System.Windows.Automation.PropertyCondition -ArgumentList @([System.Windows.Automation.AutomationElement]::ProcessIdProperty,[int]$p.processId)
$windowCondition=New-Object System.Windows.Automation.PropertyCondition -ArgumentList @([System.Windows.Automation.AutomationElement]::NativeWindowHandleProperty,[int]$p.windowId)
$conditions=[System.Windows.Automation.Condition[]]@($processCondition,$windowCondition)
$windowMatch=New-Object System.Windows.Automation.AndCondition -ArgumentList (,$conditions)
$w=$root.FindFirst([System.Windows.Automation.TreeScope]::Children,$windowMatch)
if($null -eq $w){throw 'target unavailable'}
$all=$w.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
$items=@($all|%{$rid=[string]::Join('.', $_.GetRuntimeId());$ip=$null;$vp=$null;$ci=$_.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$ip);$cv=$_.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$vp);@{processId=$_.Current.ProcessId;windowId=$w.Current.NativeWindowHandle;runtimeId=$rid;name=$_.Current.Name;automationId=$_.Current.AutomationId;controlType=$_.Current.ControlType.ProgrammaticName;enabled=$_.Current.IsEnabled;visible=(-not $_.Current.IsOffscreen);password=$_.Current.IsPassword;supportsInvoke=$ci;supportsSetValue=$cv;bounds=Rect $_.Current.BoundingRectangle}})
if($Operation -eq 'controls'){$items|ConvertTo-Json -Compress -Depth 5;exit}
$target=$null;foreach($e in $all){if(([string]::Join('.', $e.GetRuntimeId())) -eq [string]$p.runtimeId){$target=$e;break}}
if($null -eq $target){throw 'target unavailable'}
if($Operation -eq 'invoke'){$pat=$target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern);$pat.Invoke();@{ok=$true}|ConvertTo-Json -Compress;exit}
if($Operation -eq 'set'){$pat=$target.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern);$pat.SetValue([string]$p.value);@{ok=$true}|ConvertTo-Json -Compress;exit}
throw 'unsupported operation'`;
    try {
      const encodedScript = Buffer.from(script, 'utf16le').toString('base64');
      const { stdout } = await execFileAsync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedScript], {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, TOOLBRAID_UIA_OPERATION: operation, TOOLBRAID_UIA_PAYLOAD: JSON.stringify(payload) },
      });
      return stdout.trim() ? JSON.parse(stdout) : null;
    } catch { fail('UIA_ADAPTER_FAILED', 'Windows UI Automation operation failed.'); }
  }
  const list = async (operation, payload) => { const result = await run(operation, payload); return Array.isArray(result) ? result : (result ? [result] : []); };
  return Object.freeze({ listWindows: () => list('windows'), listControls: (window) => list('controls', window), invoke: (control) => run('invoke', control), setValue: (control, value) => run('set', { ...control, value }) });
}

export function createWindowsUiaBroker({ adapter = createPowerShellUiaAdapter(), now = Date.now, handleTtlMs = HANDLE_TTL_MS, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!adapter || !['listWindows', 'listControls', 'invoke', 'setValue'].every((name) => typeof adapter[name] === 'function')) throw new TypeError('A UIA adapter is required.');
  if (!Number.isInteger(handleTtlMs) || handleTtlMs < 1 || handleTtlMs > 15 * 60_000) throw new RangeError('Invalid handle TTL.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30_000) throw new RangeError('Invalid UIA timeout.');
  const windows = new Map(); const controls = new Map();
  function prune() { const instant = now(); for (const map of [windows, controls]) for (const [key, value] of map) if (value.expiresAt <= instant) map.delete(key); }
  async function timed(work) {
    let timer;
    try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new WindowsUiaError('UIA_TIMEOUT', 'Windows UI Automation timed out.')), timeoutMs); })]); }
    catch (error) { if (error instanceof WindowsUiaError) throw error; fail('UIA_ADAPTER_FAILED', 'Windows UI Automation operation failed.'); }
    finally { if (timer) clearTimeout(timer); }
  }
  function publicWindow(item, handle) { return Object.freeze({ handle, name: clean(item.name, 512), enabled: true, visible: true, bounds: boundedRect(item.bounds) }); }
  function publicControl(item, handle) { return Object.freeze({ handle, name: clean(item.name, 512), controlType: clean(item.controlType, 128), enabled: true, visible: true, bounds: boundedRect(item.bounds), supportsInvoke: item.supportsInvoke === true, supportsSetValue: item.supportsSetValue === true }); }
  async function liveWindow(binding) { const found = (await timed(Promise.resolve(adapter.listWindows()))).find((item) => sameWindow(binding, item)); if (!found || found.enabled !== true || found.visible !== true) fail('UIA_WINDOW_DRIFT', 'The selected window changed or is unavailable.'); return found; }
  async function liveControl(binding) { await liveWindow(binding); const found = (await timed(Promise.resolve(adapter.listControls(binding)))).find((item) => sameControl(binding, item)); if (!found || found.enabled !== true || found.visible !== true || blocked(found)) fail('UIA_CONTROL_DRIFT', 'The selected control changed or is unavailable.'); return found; }
  async function call(name, args = {}, ownerId = 'local-owner') {
    prune();
    const caller = owner(ownerId);
    if (!args || typeof args !== 'object' || Array.isArray(args)) fail('UIA_ARGUMENTS_INVALID', 'Arguments must be an object.');
    if (name === 'windows.list') {
      const result = [];
      for (const item of (await timed(Promise.resolve(adapter.listWindows()))).slice(0, MAX_WINDOWS)) { if (item?.enabled !== true || item?.visible !== true || !Number.isInteger(item.processId)) continue; const handle = opaque(); windows.set(handle, { ownerId: caller, processId: item.processId, windowId: item.windowId, expiresAt: now() + handleTtlMs }); result.push(publicWindow(item, handle)); }
      return Object.freeze({ windows: Object.freeze(result) });
    }
    if (name === 'controls.list') {
      const binding = windows.get(args.window); if (!binding || binding.ownerId !== caller) fail('UIA_WINDOW_HANDLE_STALE', 'List windows again.'); await liveWindow(binding); const result = [];
      for (const item of (await timed(Promise.resolve(adapter.listControls(binding)))).slice(0, MAX_CONTROLS)) { if (item?.enabled !== true || item?.visible !== true || blocked(item) || !item.runtimeId) continue; const handle = opaque(); controls.set(handle, { ...binding, runtimeId: item.runtimeId, controlType: item.controlType, expiresAt: now() + handleTtlMs }); result.push(publicControl(item, handle)); }
      return Object.freeze({ controls: Object.freeze(result) });
    }
    const binding = controls.get(args.control); if (!binding || binding.ownerId !== caller) fail('UIA_CONTROL_HANDLE_STALE', 'List controls again.'); const control = await liveControl(binding);
    if (name === 'control.invoke') { if (control.supportsInvoke !== true) fail('UIA_PATTERN_UNSUPPORTED', 'This control cannot be invoked.'); await timed(Promise.resolve(adapter.invoke(control))); controls.delete(args.control); return Object.freeze({ invoked: true }); }
    if (name === 'control.set_value') { if (control.supportsSetValue !== true || blocked(control)) fail('UIA_PATTERN_UNSUPPORTED', 'This control cannot accept a value.'); const value = clean(args.value, MAX_TEXT); if (!value && args.value !== '') fail('UIA_VALUE_INVALID', 'A bounded string value is required.'); await timed(Promise.resolve(adapter.setValue(control, value))); controls.delete(args.control); return Object.freeze({ changed: true }); }
    fail('UIA_TOOL_UNKNOWN', 'Unsupported Windows UI Automation tool.');
  }
  const descriptors = Object.freeze([
    { name: 'windows.list', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'controls.list', inputSchema: { type: 'object', properties: { window: { type: 'string', minLength: 16, maxLength: 128 } }, required: ['window'], additionalProperties: false } },
    { name: 'control.invoke', inputSchema: { type: 'object', properties: { control: { type: 'string', minLength: 16, maxLength: 128 } }, required: ['control'], additionalProperties: false } },
    { name: 'control.set_value', inputSchema: { type: 'object', properties: { control: { type: 'string', minLength: 16, maxLength: 128 }, value: { type: 'string', maxLength: MAX_TEXT } }, required: ['control', 'value'], additionalProperties: false } },
  ].map((value) => Object.freeze(value)));
  return Object.freeze({ call, invalidate() { windows.clear(); controls.clear(); }, descriptors: () => descriptors });
}

export { HANDLE_TTL_MS as WINDOWS_UIA_HANDLE_TTL_MS };
