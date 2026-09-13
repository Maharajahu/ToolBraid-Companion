import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageSnapshot } from '../../src/universal/snapshot.js';
import { createWhatsAppWebAdapter } from '../../src/site-adapters/whatsapp.js';
import { createTelegramWebAdapter } from '../../src/site-adapters/telegram.js';
import { createDiscordWebAdapter } from '../../src/site-adapters/discord.js';
import { createSiteAdapterRegistry } from '../../src/site-adapters/registry.js';

function page(url, controls, extra={}){const u=new URL(url);return createPageSnapshot({metadata:{url,origin:u.origin,title:extra.title??'Owner chat'},mainText:extra.mainText??'Alice Hello',headings:[{level:1,text:'Alice'}],accessibleControls:controls,elementRefs:controls.map(c=>({ref:c.ref,tagName:c.role==='textbox'?'div':'button',...c})),fileInputs:extra.fileInputs??[]});}
const controls=[{ref:'composer',role:'textbox',type:'contenteditable',name:'Message'},{ref:'send',role:'button',name:'Send'}];
const cases=[
  ['WhatsApp',createWhatsAppWebAdapter(),'https://web.whatsapp.com/','read_whatsapp_conversation','prepare_whatsapp_message','send_prepared_whatsapp_message'],
  ['Telegram',createTelegramWebAdapter(),'https://web.telegram.org/k/#123','read_telegram_conversation','prepare_telegram_message','send_prepared_telegram_message'],
  ['Discord',createDiscordWebAdapter(),'https://discord.com/channels/123/456','read_discord_channel','prepare_discord_message','send_prepared_discord_message'],
];
for(const [label,adapter,url,read,prepare,send] of cases)test(`${label} exposes active-context read, prepare, and send`,()=>{const snapshot=page(url,controls);assert.equal(adapter.matches(snapshot),true);const tools=adapter.generateTools(snapshot);assert.deepEqual(tools.map(t=>t.name),[read,prepare,send]);assert.equal(tools[0].classification,'read');assert.equal(tools[1].target.ref,'composer');assert.equal(tools[2].target.ref,'send');assert.equal(adapter.executeRead(tools[0],snapshot).untrustedContent,true);});

test('messaging adapters reject lookalikes, ambiguous composers, and login or challenge screens',()=>{for(const [,adapter,url] of cases){assert.equal(adapter.matches(page(url,[...controls,{ref:'composer2',role:'textbox',name:'Message'}])),false);assert.equal(adapter.matches(page(url,controls,{mainText:'Security check verification code'})),false);}assert.equal(createWhatsAppWebAdapter().matches(page('https://web.whatsapp.com.evil.test/',controls)),false);assert.equal(createTelegramWebAdapter().matches(page('https://telegram.org/',controls)),false);assert.equal(createDiscordWebAdapter().matches(page('https://discord.com/login',controls)),false);});

test('attachment staging is not invented when canonical adapter snapshots omit file-input bindings',()=>{for(const [,adapter,url] of cases){const snapshot=page(url,controls,{fileInputs:[{ref:'file',name:'Attach',accept:'image/*'}]});assert.equal(adapter.generateTools(snapshot).some(t=>t.name.startsWith('inspect_')),false);}});

test('send controls fail closed when ambiguous',()=>{for(const [,adapter,url,,prepare] of cases){const snapshot=page(url,[...controls,{ref:'send2',role:'button',name:'Send'}]);assert.deepEqual(adapter.generateTools(snapshot).map(t=>t.name),[adapter.generateTools(snapshot)[0].name,prepare]);}});

test('prepare postconditions verify only the exact observed draft value',()=>{for(const [,adapter,url,,prepareName] of cases){
  const before=page(url,controls);
  const tool=adapter.generateTools(before).find(t=>t.name===prepareName);
  assert.equal(tool.postcondition.observation,'page-snapshot');
  const after=page(url,[{...controls[0],value:'hello owner'},{...controls[1]}]);
  const success=adapter.verifyPostcondition({tool,beforeSnapshot:before,afterSnapshot:after,preparedAction:{arguments:{text:'hello owner'}}});
  assert.equal(success.status,'verified-success');
  const mismatch=adapter.verifyPostcondition({tool,beforeSnapshot:before,afterSnapshot:after,preparedAction:{arguments:{text:'different'}}});
  assert.equal(mismatch.status,'unverified');
}});

test('send postconditions require composer clearing or exact send-control transition',()=>{for(const [,adapter,url,,,sendName] of cases){
  const before=page(url,[{...controls[0],value:'prepared text'},{...controls[1]}]);
  const tool=adapter.generateTools(before).find(t=>t.name===sendName);
  assert.equal(tool.postcondition.observation,'page-snapshot');
  const cleared=page(url,[{...controls[0],value:''},{...controls[1]}]);
  assert.equal(adapter.verifyPostcondition({tool,beforeSnapshot:before,afterSnapshot:cleared}).status,'verified-success');
  const unchanged=page(url,[{...controls[0],value:'prepared text'},{...controls[1]}]);
  assert.equal(adapter.verifyPostcondition({tool,beforeSnapshot:before,afterSnapshot:unchanged}).status,'unverified');
  const disappeared=page(url,[{...controls[0],value:'prepared text'}]);
  assert.equal(adapter.verifyPostcondition({tool,beforeSnapshot:before,afterSnapshot:disappeared}).status,'verified-success');
}});

test('messaging postconditions stay unverified on route and target-binding drift',()=>{for(const [label,adapter,url,,prepareName] of cases){
  const before=page(url,controls),tool=adapter.generateTools(before).find(t=>t.name===prepareName);
  const driftUrl=label==='Discord'?'https://discord.com/channels/123/999':`${url}${url.includes('#')?'other':'?other=1'}`;
  const routeDrift=page(driftUrl,[{...controls[0],value:'hello'},{...controls[1]}]);
  assert.equal(adapter.verifyPostcondition({tool,beforeSnapshot:before,afterSnapshot:routeDrift,preparedAction:{arguments:{text:'hello'}}}).status,'unverified');
  const alteredTool={...tool,target:{...tool.target,targetFingerprint:'0'.repeat(64)}};
  const after=page(url,[{...controls[0],value:'hello'},{...controls[1]}]);
  assert.equal(adapter.verifyPostcondition({tool:alteredTool,beforeSnapshot:before,afterSnapshot:after,preparedAction:{arguments:{text:'hello'}}}).status,'unverified');
}});

test('postconditions execute through the site-adapter registry contract',()=>{for(const [,adapter,url,,prepareName] of cases){
  const registry=createSiteAdapterRegistry({adapters:[adapter]});
  const before=page(url,controls),tool=registry.generateTools(before).find(t=>t.name===prepareName);
  const after=page(url,[{...controls[0],value:'registry draft'},{...controls[1]}]);
  const verdict=registry.verifyPostcondition(tool,{tabId:1,frameId:0,sessionId:'messaging-session',beforeSnapshot:before,afterSnapshot:after,preparedAction:{arguments:{text:'registry draft'}}});
  assert.equal(verdict.status,'verified-success');
}});
