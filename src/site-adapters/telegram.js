import { readDescriptor } from './common.js';
import { normalizedControlText, uniqueControl, verifiedActionDescriptor } from './action.js';
import { elementFingerprint } from '../universal/snapshot.js';
import { validateToolDescriptor } from '../universal/tools.js';

const BLOCKED = /(?:log\s*in|sign\s*in|qr\s*code|captcha|verification\s*code|two[- ]step|security\s*check|challenge|phone\s*number)/i;
const IDS=Object.freeze({prepare:'telegram.message.prepare.v1',send:'telegram.message.send.v1'});
function text(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function exact(snapshot) { try { const u = new URL(snapshot.metadata.url); return u.protocol === 'https:' && u.hostname.toLowerCase() === 'web.telegram.org' && !u.port && !u.username && !u.password; } catch { return false; } }
function blocked(snapshot) { return BLOCKED.test(`${snapshot.metadata.title ?? ''} ${snapshot.mainText ?? ''} ${snapshot.accessibleControls.map((c) => `${c.name ?? ''} ${c.type ?? ''}`).join(' ')}`); }
function editor(c) { const n = normalizedControlText(c).toLowerCase(); return (text(c?.role).toLowerCase() === 'textbox' || ['text','textarea','contenteditable'].includes(text(c?.type).toLowerCase())) && /(?:message|mesaj)/i.test(n) && !/(?:search|caut)/i.test(n); }
function send(c) { return text(c?.role).toLowerCase() === 'button' && /^(?:send|trimite)(?:\s+message)?$/i.test(normalizedControlText(c)); }
function active(snapshot) { return Boolean(uniqueControl(snapshot, editor)) && !blocked(snapshot); }
function route(s){try{const u=new URL(s.metadata.url);return exact(s)?`${u.origin}${u.pathname}${u.search}${u.hash}`:null;}catch{return null;}}
function contract(id,v){return Object.freeze({version:1,id,adapterId:'telegram-web',adapterVersion:String(v),observation:'page-snapshot'});}
function action(s,o,id,v){const base=verifiedActionDescriptor(s,o),d={...base,postcondition:contract(id,v)};validateToolDescriptor(d);return Object.freeze(d);}
function result(status,reason,a,evidence={}){return{status,reasonCode:reason,evidence,...(a?.pageFingerprint?{afterPageFingerprint:a.pageFingerprint}:{})};}
function bound(t,s,p){const m=s.accessibleControls.filter(c=>c.ref===t?.target?.ref&&p(c)&&elementFingerprint(c)===t?.target?.targetFingerprint);return m.length===1?m[0]:null;}
function verify({tool,contract:c,beforeSnapshot:b,afterSnapshot:a,preparedAction:p}={},v){if(!b||!a||route(b)!==route(a))return result('unverified','TELEGRAM_ROUTE_DRIFT',a);const id=tool?.name==='prepare_telegram_message'?IDS.prepare:tool?.name==='send_prepared_telegram_message'?IDS.send:null;c=c??tool?.postcondition;if(!id||c?.id!==id||c?.adapterId!=='telegram-web'||String(c?.adapterVersion)!==String(v))return result('unverified','TELEGRAM_CONTRACT_MISMATCH',a);const target=bound(tool,b,tool.name.startsWith('prepare_')?editor:send);if(!target)return result('unverified','TELEGRAM_TARGET_BINDING_DRIFT',a);if(tool.name.startsWith('prepare_')){const wanted=text(p?.arguments?.text??p?.normalizedArguments?.text),ed=uniqueControl(a,editor);return wanted&&ed&&ed.ref===target.ref&&text(ed.value)===wanted?result('verified-success','TELEGRAM_DRAFT_CONFIRMED',a,{editorRef:ed.ref}):result('unverified','TELEGRAM_DRAFT_NOT_CONFIRMED',a);}const be=uniqueControl(b,editor),ae=uniqueControl(a,editor),buttons=a.accessibleControls.filter(send),cleared=Boolean(be&&text(be.value)&&ae&&ae.ref===be.ref&&text(ae.value)===''),changed=buttons.length===0||(buttons.length===1&&!buttons.some(x=>x.ref===target.ref&&elementFingerprint(x)===elementFingerprint(target)));return cleared||changed?result('verified-success','TELEGRAM_SEND_CONFIRMED',a,{composerCleared:cleared,sendControlChanged:changed}):result('unverified','TELEGRAM_SEND_NOT_CONFIRMED',a,{composerCleared:false,sendControlChanged:false});}
function read(snapshot) { return Object.freeze({ service: 'telegram', title: text(snapshot.metadata.title).slice(0,512), heading: text(snapshot.headings?.[0]?.text).slice(0,512)||null, visibleText: text(snapshot.mainText).slice(0,20000), url: snapshot.metadata.url, pageFingerprint: snapshot.pageFingerprint, untrustedContent: true }); }

export function createTelegramWebAdapter({ version = '1' } = {}) {
  return Object.freeze({ id: 'telegram-web', version, priority: 130,
    matches(snapshot) { return exact(snapshot) && active(snapshot); },
    generateTools(snapshot) {
      if (!exact(snapshot) || !active(snapshot)) return Object.freeze([]);
      const tools = [readDescriptor(snapshot, { adapterId:'telegram-web', adapterVersion:version, sourceType:'verified-adapter', name:'read_telegram_conversation', title:'Read Telegram conversation', description:'Read the currently visible active Telegram conversation context.', effectSummary:'Read only the active visible Telegram conversation.', evidence:[{code:'TELEGRAM_ACTIVE_CONVERSATION',adapterVersion:version}] })];
      const composer=uniqueControl(snapshot,editor), button=uniqueControl(snapshot,send);
      if (composer) tools.push(action(snapshot,{adapterId:'telegram-web',adapterVersion:version,name:'prepare_telegram_message',title:'Prepare Telegram message',description:'Stage text in the exact active visible Telegram composer without sending it.',risk:'account-content',target:composer,inputSchema:{type:'object',properties:{text:{type:'string',minLength:1,maxLength:4096}},required:['text'],additionalProperties:false},summary:'Prepare a message in the active Telegram conversation.'},IDS.prepare,version));
      if (button) tools.push(action(snapshot,{adapterId:'telegram-web',adapterVersion:version,name:'send_prepared_telegram_message',title:'Send prepared Telegram message',description:'Send the message already prepared in the exact active visible Telegram conversation.',risk:'account-content',target:button,summary:'Send the prepared message to the active Telegram conversation.'},IDS.send,version));
      return Object.freeze(tools);
    },
    executeRead(tool,snapshot){if(!exact(snapshot)||!active(snapshot))throw new Error('Telegram active conversation changed.');if(tool.name==='read_telegram_conversation')return read(snapshot);throw new Error('Unsupported Telegram read tool.');},verifyPostcondition(c){return verify(c,version);}
  });
}
