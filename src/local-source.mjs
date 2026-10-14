import {lstat} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';

// Inspect the supplied path before realpath can hide a link or Windows junction.
export async function rejectLinkedSource(path,signal){
  for(let current=resolve(path);;current=dirname(current)){
    signal?.throwIfAborted();
    if((await lstat(current)).isSymbolicLink())throw new Error('Source links and junctions are not accepted; use the original local file path.');
    if(dirname(current)===current)break;
  }
}
