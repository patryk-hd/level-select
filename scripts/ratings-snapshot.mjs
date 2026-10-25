import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { emptyRatings, validateRatingsSnapshot } from '../ranking/snapshot.js';

export async function readRatingsSnapshot(root,{local=false}={}) {
  const file=path.join(root,local?'library/data/ratings.json':'library/sample/ratings.json');
  let source;
  try{source=await readFile(file,'utf8');}
  catch(error){if(error.code==='ENOENT')return emptyRatings(local?'personal':'sample');throw error;}
  const snapshot=validateRatingsSnapshot(JSON.parse(source));
  if(snapshot.workspace!==(local?'personal':'sample'))throw Error('Ratings workspace does not match its dataset');
  return snapshot;
}
