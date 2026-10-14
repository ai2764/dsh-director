import {createRequire} from 'node:module';
import {join} from 'node:path';
// Integration fixture only; consumers do not receive this in the tarball.
export const harnessRequire=createRequire(join(process.env.DSH_TEST_ROOT ?? join(process.env.APPDATA,'npm/node_modules/@deepseek-ai/dsh'),'package.json'));
export function localFs(){
  const {Context}=harnessRequire('@deepseek-ai/cordis');
  const {LocalFileSystem}=harnessRequire('@deepseek-ai/dsh-fs-local');
  return new LocalFileSystem(new Context(),{diffBasisMaxBytes:1048576});
}
