import assert from 'node:assert/strict';import test from 'node:test';import {mkdtemp,readFile,writeFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {AtomicJsonStore} from '../../bridge/atomic-json-store.mjs';import {createDurableControl} from '../../bridge/durable-control.mjs';
import {createDurableToolDispatcher} from '../../bridge/native-host.mjs';
async function setup(dispatch=async call=>({ok:true,tool:call.toolName})){const dir=await mkdtemp(path.join(os.tmpdir(),'tb-durable-'));const store=new AtomicJsonStore({filePath:path.join(dir,'state.json')});let instant=10000;const control=createDurableControl({store,dispatch,now:()=>instant,setTimer:()=>1,clearTimer:()=>{}});return {dir,store,control,setNow:v=>{instant=v;}};}
test('atomic JSON store persists multiple keys without exposing its path',async()=>{const {dir,store}=await setup();await Promise.all([store.write('a',{x:1}),store.write('b',{y:2})]);assert.deepEqual(await store.read('a'),{x:1});assert.deepEqual(await store.read('b'),{y:2});assert.equal(Object.hasOwn(store.publicInfo(),'filePath'),false);assert.equal(JSON.parse(await readFile(path.join(dir,'state.json'),'utf8')).version,1);});
test('atomic JSON store redacts raw filesystem failures',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'tb-store-error-')),blocker=path.join(dir,'private-blocker');await writeFile(blocker,'x');const store=new AtomicJsonStore({filePath:path.join(blocker,'state.json')});await assert.rejects(store.write('a',{x:1}),error=>error.code==='ATOMIC_STORE_UNAVAILABLE'&&!error.message.includes(blocker)&&!error.message.includes('private-blocker'));});
test('durable control validates exact calls and returns bounded public mission state',async()=>{const calls=[];const {control}=await setup(async call=>{calls.push(call);return {done:true};});const created=await control.mission.create({missionId:'m1',plan:[{id:'read',kind:'read',input:{toolName:'tool.read',arguments:{q:'x'}}},{id:'mutate',kind:'mutation',dependsOn:['read'],input:{toolName:'tool.write',arguments:{value:'y'}}}]});assert.equal(created.status,'pending');assert.equal(Object.hasOwn(created.steps[0],'input'),false);const done=await control.mission.run();assert.equal(done.status,'complete');assert.deepEqual(calls.map(c=>c.toolName),['tool.read','tool.write']);assert.deepEqual(await control.mission.clear(),{cleared:true});assert.equal(await control.mission.state(),null);await assert.rejects(control.mission.create({missionId:'m2',plan:[{id:'x',kind:'read',input:{toolName:'x',arguments:{},extra:true}}]}),/exactly/);});
test('interrupted mutation remains outcome-unknown and is never redispatched',async()=>{const {store}=await setup();await store.write('toolbraid.durable-control.mission.v1',{version:1,missionId:'m',status:'running',cancelled:false,createdAt:1,updatedAt:1,steps:[{id:'x',kind:'mutation',dependsOn:[],input:{toolName:'danger',arguments:{}},idempotencyKey:'x:x',status:'dispatching',attempts:1,result:null,error:null}]});let calls=0;const control=createDurableControl({store,dispatch:async()=>{calls+=1;},now:()=>2,setTimer:()=>1,clearTimer:()=>{}});const state=await control.mission.run();assert.equal(state.status,'outcome-unknown');assert.equal(state.steps[0].status,'outcome-unknown');assert.equal(calls,0);});
test('scheduler validates exact payloads, lanes and deterministic tick lifecycle',async()=>{const calls=[];const {control,setNow}=await setup(async call=>calls.push(call));const added=await control.schedule.add({id:'once',type:'once',at:11000,lane:'mutation',payload:{toolName:'publish',arguments:{id:1}}});assert.equal(Object.hasOwn(added.payload,'arguments'),false);assert.ok(added.payload.argumentBytes>0);assert.equal((await control.schedule.list()).length,1);assert.equal((await control.schedule.pause('once')).paused,true);assert.equal((await control.schedule.resume('once')).paused,false);setNow(11000);const state=await control.schedule.tick();assert.equal(state[0].nextRunAt,null);assert.equal(calls[0].toolName,'publish');assert.equal(calls[0].lane,'mutation');assert.equal(await control.schedule.delete('once'),true);await assert.rejects(control.schedule.add({id:'bad',type:'once',at:12000,lane:'read',payload:{toolName:'x',arguments:{password:'no'}}}),/Secrets/);});
test('durable dispatch resolves a stable original name without persisting page output',async()=>{const requests=[];const dispatch=createDurableToolDispatcher(async(method,params)=>{requests.push({method,params});if(method==='tools.list')return{tools:[{name:'toolbraid.publish.volatile',_meta:{'toolbraid/originalName':'publish','toolbraid/classification':'mutation'}}]};return{ok:true,result:{verification:{status:'verified-success'},pageContent:'private'}};});const result=await dispatch({toolName:'publish',kind:'mutation',arguments:{text:'hello'}});assert.deepEqual(result,{completed:true,toolName:'publish',verification:'verified-success'});assert.deepEqual(requests,[{method:'tools.list',params:{}},{method:'tools.call',params:{name:'toolbraid.publish.volatile',arguments:{text:'hello'}}}]);await assert.rejects(createDurableToolDispatcher(async()=>({tools:[]}))({toolName:'missing',arguments:{}}),error=>error.code==='DURABLE_TOOL_UNAVAILABLE');});

test('durable dispatch rejects mutation labels that would permit automatic replay',async()=>{
  for(const lane of ['read','idempotent']){
    let calls=0;
    const dispatch=createDurableToolDispatcher(async(method)=>{if(method==='tools.list')return{tools:[{name:'publish',annotations:{readOnlyHint:false},_meta:{'toolbraid/classification':'mutation'}}]};calls++;return{ok:true};});
    await assert.rejects(dispatch({toolName:'publish',kind:lane,arguments:{}}),{code:'DURABLE_KIND_MISMATCH'});
    await assert.rejects(dispatch({toolName:'publish',lane,arguments:{}}),{code:'DURABLE_KIND_MISMATCH'});
    assert.equal(calls,0);
  }
});

test('durable missions stop on approval-required and unverified outcomes without retrying',async()=>{
  for(const response of [{ok:true,result:{status:'approval-required'}},{ok:true,result:{status:'dispatched',verification:{status:'unverified'}}},{ok:false,error:{code:'REJECTED'}}]){
    let calls=0;
    const dispatch=createDurableToolDispatcher(async(method)=>{if(method==='tools.list')return{tools:[{name:'publish',annotations:{readOnlyHint:false}}]};calls++;return response;});
    const {control}=await setup(dispatch);
    await control.mission.create({missionId:'uncertain',plan:[{id:'send',kind:'mutation',input:{toolName:'publish',arguments:{}}},{id:'next',kind:'mutation',dependsOn:['send'],input:{toolName:'publish',arguments:{}}}]});
    assert.equal((await control.mission.run()).status,'outcome-unknown');
    assert.equal((await control.mission.run()).status,'outcome-unknown');
    assert.equal(calls,1);
  }
});

test('durable payloads are exact, reject truncation and do not accept reserved object keys',async()=>{
  for(const args of [{text:'x'.repeat(4097)},JSON.parse('{"__proto__":{"polluted":true}}'),[],null]){
    const {control}=await setup();
    await assert.rejects(control.mission.create({missionId:'invalid',plan:[{id:'send',kind:'mutation',input:{toolName:'publish',arguments:args}}]}));
    assert.equal(await control.mission.state(),null);
  }
});
test('durable plans reject internal paths and file-input proxies',async()=>{const {control}=await setup();await assert.rejects(control.mission.create({missionId:'path',plan:[{id:'x',kind:'mutation',input:{toolName:'upload',arguments:{resolvedLocalPath:'C:\\private.txt'}}}]}),/Secrets/);const dispatch=createDurableToolDispatcher(async()=>({tools:[{name:'toolbraid.attach_file.volatile',_meta:{'toolbraid/originalName':'upload','toolbraid/fileInput':true}}]}));await assert.rejects(dispatch({toolName:'upload',arguments:{grantId:'a'.repeat(64)}}),error=>error.code==='DURABLE_FILE_TOOL_UNSUPPORTED');});
