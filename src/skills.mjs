import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export async function createBundledProvider(root=resolve(dirname(fileURLToPath(import.meta.url)),'../skills')) {
  const definitions=new Map();
  for (const name of ['director','h3-prompt-writing']) {
    const path=resolve(root,name,'SKILL.md');
    const text=await readFile(path,'utf8');
    const parsed=/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
    if (!parsed) throw new Error(`Invalid bundled skill: ${name}`);
    const description=/^description:\s*(.+)$/m.exec(parsed[1])?.[1];
    if (!description || !new RegExp(`^name: ${name}$`,'m').test(parsed[1])) throw new Error(`Invalid skill metadata: ${name}`);
    definitions.set(name,{name,description,content:parsed[2].trimStart(),path,
      source:'bundled',provider:'dsh-director-bundled',invocation:{modelInvocable:true,userInvocable:true},
      resourceBase:{kind:'directory',path:dirname(path)}});
  }
  const candidates=[...definitions.values()].map(({content,...d})=>({...d,rank:600,locator:d.name}));
  return {name:'dsh-director-bundled',async list(){return {candidates,complete:true};},
    async get(candidate){return definitions.get(candidate.locator);}};
}
