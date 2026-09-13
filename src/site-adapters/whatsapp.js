import { readDescriptor } from './common.js';
import { normalizedControlText, uniqueControl, verifiedActionDescriptor } from './action.js';
import { elementFingerprint } from '../universal/snapshot.js';
import { validateToolDescriptor } from '../universal/tools.js';

const HOST = 'web.whatsapp.com';
const BLOCKED = /(?:log\s*in|sign\s*in|scan\s+(?:the\s+)?qr|qr\s*code|captcha|verification\s*code|two[- ]step|security\s*check|challenge|phone\s*number)/i;
const IDS = Object.freeze({ prepare: 'whatsapp.message.prepare.v1', send: 'whatsapp.message.send.v1' });

function text(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function url(snapshot) { try { return new URL(snapshot.metadata.url); } catch { return null; } }
function exactOrigin(snapshot) {
  const value = url(snapshot);
  return value?.protocol === 'https:' && value.hostname.toLowerCase() === HOST && !value.port && !value.username && !value.password;
}
function blocked(snapshot) {
  const controls = snapshot.accessibleControls.map((control) => `${control.name ?? ''} ${control.type ?? ''}`).join(' ');
  return BLOCKED.test(`${snapshot.metadata.title ?? ''} ${snapshot.mainText ?? ''} ${controls}`);
}
function editor(control) {
  const role = text(control?.role).toLowerCase();
  const type = text(control?.type).toLowerCase();
  const name = normalizedControlText(control).toLowerCase();
  return (role === 'textbox' || ['text', 'textarea', 'contenteditable'].includes(type))
    && /(?:type\s+a\s+message|message|mesaj)/i.test(name)
    && !/(?:search|caut)/i.test(name);
}
function send(control) {
  return text(control?.role).toLowerCase() === 'button'
    && /^(?:send|trimite)(?:\s+message)?$/i.test(normalizedControlText(control));
}
function active(snapshot) { return Boolean(uniqueControl(snapshot, editor)) && !blocked(snapshot); }
function route(snapshot) { const u=url(snapshot); return exactOrigin(snapshot)?`${u.origin}${u.pathname}${u.search}${u.hash}`:null; }
function contract(id,version){return Object.freeze({version:1,id,adapterId:'whatsapp-web',adapterVersion:String(version),observation:'page-snapshot'});}
function action(snapshot,options,id,version){const base=verifiedActionDescriptor(snapshot,options);const value={...base,postcondition:contract(id,version)};validateToolDescriptor(value);return Object.freeze(value);}
function result(status,reason,after,evidence={}){return {status,reasonCode:reason,evidence,...(after?.pageFingerprint?{afterPageFingerprint:after.pageFingerprint}:{})};}
function bound(tool,snapshot,predicate){const ref=tool?.target?.ref,fp=tool?.target?.targetFingerprint;const found=snapshot.accessibleControls.filter(c=>c.ref===ref&&predicate(c)&&elementFingerprint(c)===fp);return found.length===1?found[0]:null;}
function value(c){return text(c?.value);}
function verify({tool,contract:supplied,beforeSnapshot:before,afterSnapshot:after,preparedAction}={},version){
  if(!before||!after||route(before)!==route(after))return result('unverified','WHATSAPP_ROUTE_DRIFT',after);
  const expected=tool?.name==='prepare_whatsapp_message'?IDS.prepare:tool?.name==='send_prepared_whatsapp_message'?IDS.send:null;
  const c=supplied??tool?.postcondition;
  if(!expected||c?.id!==expected||c?.adapterId!=='whatsapp-web'||String(c?.adapterVersion)!==String(version))return result('unverified','WHATSAPP_CONTRACT_MISMATCH',after);
  const beforeTarget=bound(tool,before,tool.name.startsWith('prepare_')?editor:send);
  if(!beforeTarget)return result('unverified','WHATSAPP_TARGET_BINDING_DRIFT',after);
  if(tool.name==='prepare_whatsapp_message'){
    const expectedText=text(preparedAction?.arguments?.text??preparedAction?.normalizedArguments?.text);
    const afterEditor=uniqueControl(after,editor);
    if(!expectedText||!afterEditor||afterEditor.ref!==beforeTarget.ref)return result('unverified','WHATSAPP_DRAFT_NOT_OBSERVED',after);
    return value(afterEditor)===expectedText?result('verified-success','WHATSAPP_DRAFT_CONFIRMED',after,{editorRef:afterEditor.ref}):result('unverified','WHATSAPP_DRAFT_NOT_CONFIRMED',after,{editorRef:afterEditor.ref});
  }
  const beforeEditor=uniqueControl(before,editor),afterEditor=uniqueControl(after,editor);
  const afterSend=after.accessibleControls.filter(send);
  const cleared=Boolean(beforeEditor&&value(beforeEditor)&&afterEditor&&afterEditor.ref===beforeEditor.ref&&value(afterEditor)==='');
  const controlChanged=afterSend.length===0||(afterSend.length===1&&!afterSend.some(c=>c.ref===beforeTarget.ref&&elementFingerprint(c)===elementFingerprint(beforeTarget)));
  return cleared||controlChanged?result('verified-success','WHATSAPP_SEND_CONFIRMED',after,{composerCleared:cleared,sendControlChanged:controlChanged}):result('unverified','WHATSAPP_SEND_NOT_CONFIRMED',after,{composerCleared:false,sendControlChanged:false});
}
function context(snapshot) {
  return Object.freeze({
    service: 'whatsapp', title: text(snapshot.metadata.title).slice(0, 512),
    heading: text(snapshot.headings?.[0]?.text).slice(0, 512) || null,
    visibleText: text(snapshot.mainText).slice(0, 20_000), url: snapshot.metadata.url,
    pageFingerprint: snapshot.pageFingerprint, untrustedContent: true,
  });
}

export function createWhatsAppWebAdapter({ version = '1' } = {}) {
  return Object.freeze({
    id: 'whatsapp-web', version, priority: 130,
    matches(snapshot) { return exactOrigin(snapshot) && active(snapshot); },
    generateTools(snapshot) {
      if (!exactOrigin(snapshot) || !active(snapshot)) return Object.freeze([]);
      const tools = [readDescriptor(snapshot, {
        adapterId: 'whatsapp-web', adapterVersion: version, sourceType: 'verified-adapter',
        name: 'read_whatsapp_conversation', title: 'Read WhatsApp conversation',
        description: 'Read the currently visible active WhatsApp conversation context.',
        effectSummary: 'Read only the active visible WhatsApp conversation.',
        evidence: [{ code: 'WHATSAPP_ACTIVE_CONVERSATION', adapterVersion: version }],
      })];
      const composer = uniqueControl(snapshot, editor);
      const sendButton = uniqueControl(snapshot, send);
      if (composer) tools.push(action(snapshot, {
        adapterId: 'whatsapp-web', adapterVersion: version, name: 'prepare_whatsapp_message',
        title: 'Prepare WhatsApp message', description: 'Stage text in the exact active visible WhatsApp composer without sending it.',
        risk: 'account-content', target: composer,
        inputSchema: { type: 'object', properties: { text: { type: 'string', minLength: 1, maxLength: 65_536 } }, required: ['text'], additionalProperties: false },
        summary: 'Prepare a message in the active WhatsApp conversation.',
      }, IDS.prepare, version));
      if (sendButton) tools.push(action(snapshot, {
        adapterId: 'whatsapp-web', adapterVersion: version, name: 'send_prepared_whatsapp_message',
        title: 'Send prepared WhatsApp message', description: 'Send the message already prepared in the exact active visible WhatsApp conversation.',
        risk: 'account-content', target: sendButton, summary: 'Send the prepared message to the active WhatsApp conversation.',
      }, IDS.send, version));
      return Object.freeze(tools);
    },
    executeRead(tool, snapshot) {
      if (!exactOrigin(snapshot) || !active(snapshot)) throw new Error('WhatsApp active conversation changed.');
      if (tool.name === 'read_whatsapp_conversation') return context(snapshot);
      throw new Error('Unsupported WhatsApp read tool.');
    },
    verifyPostcondition(context){return verify(context,version);},
  });
}
