import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = path.join(root, '.runtime/malang');
for (const dir of ['conf', 'logs', 'temp']) fs.mkdirSync(path.join(runtime,dir), {recursive:true});
const source = path.join(root, '.runtime/nginx-1.30.6/conf/mime.types');
fs.copyFileSync(source, path.join(runtime,'conf/mime.types'));
const config = fs.readFileSync(path.join(root,'deploy/nginx.conf'),'utf8').replaceAll('__WEB_ROOT__', path.join(root,'apps/web/dist').replaceAll('\\','/'));
for (const destination of [path.join(runtime, 'conf/nginx.conf'), path.join(root, '.runtime/nginx-1.30.6/conf/nginx.conf')]) {
  fs.writeFileSync(destination, config);
}
console.log('Gateway config generated for the current project in both runtime locations (port 8081).');
