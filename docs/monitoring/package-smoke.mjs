// Generate the same reviewed synthetic mixed package used in LOCAL verification.
// First run e2e.py --fixture-only to refresh the synthetic Oracle baseline.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = await fs.readFile(path.join(root,'frontend/tools/monitoring-query/package.js'),'utf8');
const {createPackage} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const fixture = JSON.parse(await fs.readFile(path.join(root,'frontend/tools/monitoring-query/tests/fixture.json'),'utf8'));
const original = fixture.tables.DSH_MENU[0];
const group = structuredClone(fixture.tables.DSH_SUMMARY_GROUP[0]); group.GROUP_ID = crypto.randomUUID(); group.MENU_ID = original.MENU_ID;
const field = structuredClone(fixture.tables.DSH_SUMMARY_FIELD[0]); field.FIELD_ID = crypto.randomUUID(); field.GROUP_ID = group.GROUP_ID;
const operations = [
  {table:'DSH_MENU',action:'UPDATE',baseline:original,desired:{...original,MENU_LABEL:'Standalone package verified title'}},
  {table:'DSH_SUMMARY_GROUP',action:'INSERT',baseline:null,desired:group},
  {table:'DSH_SUMMARY_FIELD',action:'INSERT',baseline:null,desired:field},
];
const generated = await createPackage({identity:fixture.identity,fingerprint:fixture.fingerprint,metadata:fixture.metadata,operations,
  revision:1,actor:{source:'oracle-username',name:fixture.identity.username,databaseUsername:fixture.identity.username},
  baselineReadAt:fixture.readAt,readAt:new Date().toISOString()});
const output = path.resolve(process.argv[2] || '/tmp/ad-tools-monitoring-package'); await fs.mkdir(output,{recursive:true});
await Promise.all([
  fs.writeFile(path.join(output,'apply.sql'),generated.sql),
  fs.writeFile(path.join(output,'verify.sql'),generated.verifySql),
  fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(generated.manifest,null,2)),
  fs.writeFile(path.join(output,'changes.json'),JSON.stringify(generated.changes,null,2)),
]);
console.log(JSON.stringify({packageId:generated.packageId,scriptSha256:generated.scriptSha256,bytes:Buffer.byteLength(generated.sql),output}));
