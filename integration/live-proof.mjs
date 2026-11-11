import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {serveInspector} from '../server/live-server.mjs';
const compiler = process.env.COMPILER_DIR;
if (!compiler) throw Error('COMPILER_DIR required');
const output = process.env.EVIDENCE_DIR ?? '/tmp/atto-inspector-proof';
await mkdir(output,{recursive:true});
const cp = `${compiler}/target/classes:integration/classes:${(await readFile('integration/classpath.txt','utf8')).trim()}`;
async function run(mode) {
 const child=spawn('/Library/Java/JavaVirtualMachines/graalvm-25.jdk/Contents/Home/bin/java',['-Dpolyglot.engine.WarnInterpreterOnly=false','-cp',cp,'InspectorHost','integration/inspector.atto']);
 let log='',err=''; child.stdout.on('data',b=>{log+=b;}); child.stderr.on('data',b=>{err+=b;});
 const exited=new Promise(resolve=>child.on('exit',(code,signal)=>resolve({code,signal})));
 const until=async predicate=>{for(let i=0;i<500;i++){if(predicate())return; if(log.includes('GUEST_FAILED'))throw Error(log+err); await new Promise(r=>setTimeout(r,10));}throw Error('Timed out\n'+log+err);};
 let ui;
 try {
  await until(()=>/READY (\d+) (\S+)/.test(log));
  const [,port,key]=log.match(/READY (\d+) (\S+)/);
  const raw=async(path='/snapshot',auth=true)=>fetch(`http://127.0.0.1:${port}${path}`,{headers:auth?{'X-Inspector-Key':key}:{}});
  assert.equal((await raw('/snapshot',false)).status,403);
  assert.equal((await raw('/foreign-supervisor')).status,403);
  let snap;
  await until(()=>log.includes('GUEST_ON_START'));
  for(let i=0;i<100;i++) { snap=await(await raw()).json(); if(snap.actors.some(a=>a.mailboxDepth===3))break; await new Promise(r=>setTimeout(r,10)); }
  assert.ok(snap.actors.some(a=>a.mailboxDepth===3),'actual guest mailbox must contain exactly three pending messages');
  assert.ok(!JSON.stringify(snap).includes('PRIVATE-PAYLOAD'));
  assert.equal((await(await raw('/narrow')).json()).actors.length,0);
  assert.equal((await(await raw('/snapshot?maxNodes=1')).json()).status,'partial');
  ui=await serveInspector({nativePort:Number(port),nativeKey:key});
  const shown=await(await fetch(ui.url+'/api/v1/supervision/tree')).json();
  assert.ok(shown.actors.some(a=>a.mailboxDepth===3));
  assert.ok(!JSON.stringify(shown).includes('PRIVATE-PAYLOAD'));
  assert.equal((await fetch(ui.url+'/api/v1/supervision/tree',{method:'POST'})).status,405);
  assert.equal((await fetch(ui.url+'/api/v1/supervision/tree',{headers:{Origin:'https://attacker.invalid'}})).status,403);
  await writeFile(`${output}/${mode}-running.json`,JSON.stringify(shown,null,2));
  if(process.env.PREVIEW==='1') { console.log(`PREVIEW ${ui.url}`); await new Promise(r=>setTimeout(r,25000)); }
  child.stdin.write('release\n'); await until(()=>log.includes('GUEST_DONE'));
  const stopped=await(await fetch(ui.url+'/api/v1/supervision/tree')).json();
  assert.ok(stopped.actors.some(a=>a.spawnedBy!==null),'guest must create nested actor ancestry');
  const nested=stopped.actors.find(a=>a.spawnedBy!==null);
  assert.notEqual(nested.supervisorId,nested.spawnedBy,'spawning actor must never become supervisor');
  assert.ok(stopped.actors.length>=2 && stopped.actors.every(a=>a.status==='terminated'));
  assert.ok(stopped.actors.every(a=>a.mailboxDepth===0));
  await writeFile(`${output}/${mode}-stopped.json`,JSON.stringify(stopped,null,2));
  child.stdin.write(mode+'\n'); await until(()=>log.includes(mode==='revoke'?'REVOKED':'ADVANCED'));
  assert.equal((await raw()).status,403);
  assert.equal((await fetch(ui.url+'/api/v1/supervision/tree')).status,503);
  console.log(`PASS ${mode}: actual guest start, queue=3, ancestry, stop, scope, sanitization, partial, read-only HTTP, stale/revoked denial`);
 } finally {
  if(ui)await ui.close(); child.stdin.end('exit\n');
  const result=await exited;
  await writeFile(`${output}/${mode}-java.log`,log+'\nSTDERR\n'+err+'\nEXIT '+JSON.stringify(result)+'\n');
  assert.equal(result.code,0);
 }
}
await run('revoke'); await run('advance');
