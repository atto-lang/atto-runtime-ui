import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {serveInspector} from '../server/live-server.mjs';
if(!process.env.COMPILER_DIR) throw Error('Set COMPILER_DIR to the pinned compiler checkout');
const cp=`${process.env.COMPILER_DIR}/target/classes:integration/classes:${(await readFile('integration/classpath.txt','utf8')).trim()}`;
const child=spawn('/Library/Java/JavaVirtualMachines/graalvm-25.jdk/Contents/Home/bin/java',
 ['-Dpolyglot.engine.WarnInterpreterOnly=false','-cp',cp,'InspectorHost',process.argv[2]??'integration/inspector.atto']);
let pending='', ui, opening=false;
child.stderr.pipe(process.stderr);
child.stdout.on('data',async b=>{
 pending+=b;
 const ready=pending.match(/READY (\d+) (\S+)/);
 if(ready&&!opening){
  opening=true;
  try {ui=await serveInspector({nativePort:Number(ready[1]),nativeKey:ready[2]});
   console.log(`Inspector: ${ui.url}\nRead-only local view, 60-second grant. Type release to unblock demo startup; exit to close.`);
  } catch(e){console.error(e.message); child.stdin.end('exit\n');}
 }
 for(const line of b.toString().split('\n')) if(line&&!line.startsWith('READY '))console.log(line);
});
process.stdin.pipe(child.stdin);
child.on('exit',async code=>{if(ui)await ui.close();process.exitCode=code??1;process.stdin.destroy();});
process.once('SIGINT',()=>child.stdin.end('exit\n'));
