import {build} from 'esbuild';
import {readdir,mkdir,copyFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
await mkdir(resolve(root,'lib'),{recursive:true});
for(const name of await readdir(resolve(root,'src')))if(name.endsWith('.mjs')&&!name.endsWith('.test.mjs'))await copyFile(resolve(root,'src',name),resolve(root,'lib',name));
const result=await build({absWorkingDir:root,entryPoints:['src/client/index.jsx'],bundle:true,write:false,format:'cjs',platform:'browser',jsx:'automatic',loader:{'.css':'text'},external:['react','react/jsx-runtime'],minify:false});
const code=result.outputFiles[0].text;
await writeFile(resolve(root,'lib/client.js'),`window.__ModuleLoader__.load({id:"dsh-director",factory:(require)=>{const module={exports:{}};const exports=module.exports;\n${code}\nreturn module.exports;}});\n`);
