import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';

const indexPath=process.argv[2];
if(!indexPath)throw new Error('Usage: node scripts/match-artwork.mjs path/to/cover-art-index.json [sample-covers.json]');
const index=JSON.parse(await readFile(indexPath));
const catalog=JSON.parse(await readFile('data/catalog.json'));
const normalize=t=>t.replace(/\.png$/i,'').split(/[([]/,1)[0].replace(/,\s*(The|A|An)(?=\s*(?:-|:|$))/gi,'').replace(/^(The|A|An)\s+/i,'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/&/g,'and').toLowerCase().replace(/[^a-z0-9]/g,'');
const platforms={gc:['gamecube'],ds:['nds'],md:['genesis'],dc:['dreamcast'],tg16:['pcengine'],pcecd:['pcenginecd'],ms:['mastersystem'],gg:['gamegear'],scd:['segacd'],spectrum:['zxspectrum'],x360:['xbox360'],msx:['msx','msx2'],ps3:['ps3','ps3digital'],mame:['mame','fbneo'],cps:['fbneo','mame'],cave:['fbneo','mame']};
function score(file){return (/\b(Beta|Proto|Demo|Sample|Pirate|Unl)\b/i.test(file)||/\[(?:h|b|t|tr)/i.test(file)?1000:0)+(/\(USA\)/.test(file)?0:/\([^)]*USA[^)]*\)/.test(file)?10:/\(World\)/.test(file)?20:/Europe/.test(file)?30:/Japan/.test(file)?40:50)+(/\(Disc [2-9]/.test(file)?100:0);}
const titles=new Map(Object.entries(index.platforms).map(([key,p])=>{const map=new Map();for(const f of p.filenames){if(score(f)>=1000)continue;const n=normalize(f);if(!map.has(n)||score(f)<score(map.get(n)))map.set(n,f);}return[key,map];}));
const overrides={"Castlevania III: Dracula's Curse":"Castlevania III - Dracula's Curse","Mike Tyson's Punch-Out!!":"Mike Tyson's Punch-Out!!","Chip ’n Dale Rescue Rangers 2":"Chip 'n Dale Rescue Rangers 2","Super Mario World 2: Yoshi's Island":"Super Mario World 2 - Yoshi's Island"};
const mapping={};
for(const game of catalog.games){
  for(const key of platforms[game.systemId]||[game.systemId]){
    const p=index.platforms[key];if(!p)continue;
    const candidates=[overrides[game.title],game.title,...game.aliases].filter(Boolean);
    const filename=candidates.map(t=>titles.get(key).get(normalize(t))).find(Boolean);if(!filename)continue;
    const raw=new URL(p.rawBaseUrl+encodeURIComponent(filename));if(raw.protocol!=='https:')raw.protocol='https:';
    const sourceUrl=p.sourceBaseUrl ? p.sourceBaseUrl+encodeURIComponent(filename) : p.branch?`${p.repositoryUrl}/blob/${p.branch}/Named_Boxarts/${encodeURIComponent(filename)}`:p.repositoryUrl;
    mapping[game.id]={url:raw.href,sourceUrl};break;
  }
}
if(process.argv[3]){
  const samples=JSON.parse(await readFile(process.argv[3]));await mkdir('assets/covers',{recursive:true});
  for(const sample of samples.covers){
    const sourceName=normalize(sample.filename);
    for(const game of catalog.games){
      if(!(platforms[game.systemId]||[game.systemId]).includes(sample.platform)||normalize(overrides[game.title]||game.title)!==sourceName)continue;
      const filename=path.basename(sample.localPath);await copyFile(sample.localPath,`assets/covers/${filename}`);
      mapping[game.id]={url:sample.url,sourceUrl:sample.sourceUrl,local:`./assets/covers/${filename}`};
    }
  }
}
await writeFile('data/artwork.json',JSON.stringify(mapping)+'\n');
console.log(`Matched ${Object.keys(mapping).length} of ${catalog.games.length} games; ${Object.values(mapping).filter(c=>c.local).length} covers bundled locally.`);
