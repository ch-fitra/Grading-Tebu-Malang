import assert from 'node:assert/strict';
import { build } from 'esbuild';
const storage = new Map();
globalThis.localStorage = {getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,value), removeItem: key => storage.delete(key)};
const pending = new Map();
const counts = new Map();
globalThis.__refreshApi = path => {
  counts.set(path, (counts.get(path) ?? 0) + 1);
  return new Promise((resolve,reject) => pending.set(path,{resolve,reject}));
};
const result = await build({entryPoints:['apps/web/src/store.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{
  name:'mock-api', setup(builder) {
    builder.onResolve({filter:/^\.\/utils\/api$/}, () => ({path:'api',namespace:'mock'}));
    builder.onLoad({filter:/.*/,namespace:'mock'}, () => ({contents:'export class ApiError extends Error { constructor(message,status){super(message);this.status=status} } export const api = (...args) => globalThis.__refreshApi(...args);',loader:'js'}));
  }
}]});
const {useAppStore: store} = await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const session = {token:'fixture',user:{id:1,permissions:['dashboard.read','history.read','camera.read','model.read']}};
store.setState({session});
const first=store.getState().refresh();
const second=store.getState().refresh();
await Promise.resolve();
assert.equal(counts.get('/api/inference/history'),1,'overlapping refreshes must share pending history');
pending.get('/api/cameras').resolve([{id:2,station:2,enabled:true}]);
pending.get('/api/system/status').resolve({backend:{status:'ok'},ai:{status:'ok'},database:{status:'ok'}});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(store.getState().cameras[0].id,2);
assert.equal(store.getState().status.database.status,'ok','status must apply while history is unresolved');
assert.deepEqual(store.getState().history,[]);
console.log('PASS: camera/status apply before slow history; duplicate requests coalesced');
for(const [path,task] of pending) if(!['/api/cameras','/api/system/status'].includes(path))task.resolve(path.endsWith('/latest')?null:[]);
await Promise.all([first,second]);
const third=store.getState().refresh();
await Promise.resolve();
pending.get('/api/system/status').reject(new Error('timeout'));
await new Promise(resolve=>setImmediate(resolve));
assert.equal(store.getState().status,null,'timeout is unknown, not a fabricated service outage');
assert.equal(store.getState().cameras[0].id,2,'keep confirmed camera configuration');
// A response from the old login must never populate a replacement session.
store.setState({session:{...session,token:'replacement'},cameras:[]});
for(const [path,task] of pending) if(path!=='/api/system/status')task.resolve(path==='/api/cameras'?[{id:99}]:path.endsWith('/latest')?null:[]);
await third;
assert.deepEqual(store.getState().cameras,[]);
console.log('PASS: timeout marked unknown; old session responses ignored');
