import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('../scripts/library-control.mjs', import.meta.url));
function control(action, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helper, action], {
      env:{...process.env,RETRO_LIBRARY_PORT:String(port)}, stdio:['ignore','pipe','pipe'],
    });
    let output = '';
    child.stdout.on('data', data => {output += data;});
    child.stderr.on('data', data => {output += data;});
    child.on('error', reject);
    child.on('exit', code => resolve({code,output}));
  });
}
async function availablePort() {
  const server=http.createServer(); server.listen(0,'127.0.0.1'); await once(server,'listening');
  const port=server.address().port; server.close(); await once(server,'close'); return port;
}

test('launcher starts once, serves the library, restarts and stops only its server', {timeout:30000}, async () => {
  const port=await availablePort(), url=`http://127.0.0.1:${port}`;
  try {
    assert.equal((await control('status',port)).code,3);
    const starts=await Promise.all([control('start',port),control('start',port)]);
    for(const result of starts) assert.equal(result.code,0,result.output);
    const initial=await (await fetch(`${url}/__retro_library_health`)).json();
    assert.equal(initial.app,'retro-library');
    const image=await fetch(`${url}/assets/favicon.svg`);
    assert.equal(image.status,200);
    assert.equal(image.headers.get('cache-control'),'private, max-age=86400');
    const tag=image.headers.get('etag');assert.ok(tag);
    const cached=await fetch(`${url}/assets/favicon.svg`,{headers:{'If-None-Match':tag}});
    assert.equal(cached.status,304);assert.equal(await cached.text(),'');
    // App code and data are kept but checked on every use: a change is always picked up.
    const code=await fetch(`${url}/app.js`);
    assert.equal(code.headers.get('cache-control'),'no-cache');
    assert.equal((await fetch(`${url}/app.js`,{headers:{'If-None-Match':code.headers.get('etag')}})).status,304);
    for(const file of ['atlas.js','products.js','products-ui.js'])assert.equal((await fetch(`${url}/tracking/${file}`)).status,200);
    assert.equal((await fetch(`${url}/library/index.html`)).status,200);
    // A request addressed to another name (a website rebinding its domain to this computer) is refused.
    const rebound=await new Promise((resolve,reject)=>http.get(`${url}/library/data/library-data.js`,{headers:{Host:`evil.example:${new URL(url).port}`}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject));
    assert.equal(rebound,403);
    // Another website can't load the library file into its page; following a link here works.
    // (Node's http, as its fetch always says sec-fetch-mode: cors.)
    const browser=(route,headers)=>new Promise((resolve,reject)=>http.get(`${url}${route}`,{headers},response=>{response.resume();resolve(response);}).on('error',reject));
    assert.equal((await browser('/library/data/library-data.js',{'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'no-cors','Sec-Fetch-Dest':'script'})).statusCode,403);
    const followed=await browser('/library/index.html',{'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'});
    assert.equal(followed.statusCode,200);
    assert.equal(followed.headers['cross-origin-resource-policy'],'same-origin');
    assert.equal(followed.headers['x-frame-options'],'DENY');
    assert.equal(followed.headers['referrer-policy'],'no-referrer');
    for(const file of ['welcome.js','welcome.css'])assert.equal((await fetch(`${url}/${file}`)).status,200,file);
    for(const file of ['library/add-game.js','library/add-game.css'])assert.equal((await fetch(`${url}/${file}`)).status,200,file);
    // Add a game: only the app's own pages may use it, and only its own cover files are served.
    assert.equal((await fetch(`${url}/__retro_library/games`,{method:'POST',headers:{Origin:'https://evil.example','X-Retro-Library':'1','Content-Type':'application/json'},body:'{"action":"search","query":"zelda"}'})).status,403);
    assert.equal((await fetch(`${url}/__retro_library/games/cover?id=x`,{method:'POST',headers:{Origin:'https://evil.example','X-Retro-Library':'1'},body:'x'})).status,403);
    for(const route of ['/__retro_library/cover/manual-games.json','/__retro_library/cover/..%2Fmanual-games.json','/__retro_library/cover/manual-000000000000-000000.png'])assert.equal((await fetch(`${url}${route}`)).status,404,route);
    assert.equal((await fetch(`${url}/library/search-ui.js`)).status,200);
    assert.equal((await fetch(`${url}/ranking/evidence.js`)).status,200);
    assert.equal((await fetch(`${url}/ranking/ui.js`)).status,200);
    for(const file of ['panels.js','snapshot.js','modes.js','mode-ui.js','methodology.html','styles.css'])assert.equal((await fetch(`${url}/ranking/${file}`)).status,200);
    const ratings=await (await fetch(`${url}/library/data/ratings.json?workspace=sample`)).json();
    assert.equal(ratings.workspace,'sample');assert.ok(ratings.rows.length>0);
    for (const file of ['library-data.js','wishlist-data.js','connections.json']) {
      const response=await fetch(`${url}/library/data/${file}`);
      assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-cache');
      assert.equal((await fetch(`${url}/library/data/${file}`,{headers:{'If-None-Match':response.headers.get('etag')}})).status,304);
    }
    for (const privatePath of ['ranking/providers/vgc.mjs','ranking/crosswalk.json','.runtime/ratings/cache.json','ranking/pilot-manifest.json','ranking/fixtures/contracts.json','library/playnite_library.csv','library/steam-wishlist.json','library/data/overrides.json','library/data/cache/steam.json','scripts/build.mjs','dist-local/index.html','.env']) {
      assert.equal((await fetch(`${url}/${privatePath}`)).status,404,privatePath);
    }
    assert.equal((await control('start',port)).code,0);
    assert.equal((await (await fetch(`${url}/__retro_library_health`)).json()).pid,initial.pid);
    assert.equal((await control('restart',port)).code,0);
    assert.notEqual((await (await fetch(`${url}/__retro_library_health`)).json()).pid,initial.pid);
    assert.equal((await control('stop',port)).code,0);
    assert.equal((await control('status',port)).code,3);
  } finally { await control('stop',port); }
});

test('launcher refuses to stop or replace another application on the same port', {timeout:15000}, async () => {
  const server=http.createServer((req,res)=>{res.writeHead(200);res.end('another application');});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const port=server.address().port;
  try {
    for(const action of ['status','start','stop','restart']) {
      const result=await control(action,port);
      assert.equal(result.code,4,result.output);
      assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(),'another application');
    }
  } finally { server.closeAllConnections(); server.close(); await once(server,'close'); }
});
