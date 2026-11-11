import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRuntimeObservationBroker} from './runtime-observation-broker.mjs';

// Trusted bootstrap receives the loopback-only native adapter key. Browser
// requests never select native scope, tenant, generation, URL, or credentials.
export async function serveInspector({nativePort, nativeKey, port = 0}) {
  const origin = `http://127.0.0.1:${nativePort}`;
  const native = async path => {
    const response = await fetch(origin + path, {headers: {'X-Inspector-Key': nativeKey}, signal: AbortSignal.timeout(2000)});
    if (!response.ok) throw Error('Native observation unavailable');
    return response.json();
  };
  const meta = await native('/meta');
  const subject = Object.freeze({});
  const {authority, broker} = createRuntimeObservationBroker({source: {snapshot: ({maxNodes}) => native('/snapshot?maxNodes='+Math.min(1000,maxNodes))}});
  const grant = authority.issueGrant({subject, ...meta, ttlMs: 60000});
  const files = new Map([['/', ['index.html','text/html']], ['/app.js',['app.js','text/javascript']],
    ['/snapshot-policy.mjs',['snapshot-policy.mjs','text/javascript']], ['/style.css',['style.css','text/css']]]);
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control','no-store');
    response.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    response.setHeader('X-Content-Type-Options','nosniff');
    const expectedHost = `127.0.0.1:${server.address().port}`;
    if (request.headers.host !== expectedHost ||
        (request.headers.origin && request.headers.origin !== `http://${expectedHost}`) ||
        (request.headers['sec-fetch-site'] && !['same-origin','none'].includes(request.headers['sec-fetch-site']))) {
      response.writeHead(403); return response.end();
    }
    if (request.method !== 'GET') { response.writeHead(405); return response.end(); }
    if (request.url === '/api/v1/supervision/tree') {
      try {
        const snapshot = await broker.readSnapshot({subject,grant});
        response.setHeader('Content-Type','application/json');
        return response.end(JSON.stringify(snapshot));
      } catch { response.writeHead(503); return response.end('{"error":"OBSERVATION_UNAVAILABLE"}'); }
    }
    const file = files.get(request.url);
    if (!file) { response.writeHead(404); return response.end(); }
    response.setHeader('Content-Type',file[1]);
    let content = await readFile(fileURLToPath(new URL('../web/'+file[0],import.meta.url)));
    if (file[0] === 'index.html') content = Buffer.from(content.toString()
      .replace('<head>', '<head><meta name="observation-mode" content="read-only">')
      .replace('Request snapshot','Refresh observation')
      .replaceAll('Oreslang Runtime Inspector','AttoLang Runtime Inspector')
      .replace('Supervision hierarchy · live runtime diagnostics','Runtime observation · ungrouped actors have unknown supervision'));
    response.end(content);
  });
  await new Promise(resolve => server.listen(port,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}`, close:async()=>{authority.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));}};
}
