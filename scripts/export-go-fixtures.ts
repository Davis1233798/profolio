import {readFileSync,writeFileSync} from 'node:fs';
import {createSqliteD1} from '../lib/db/sqlite-d1';
import {runWithDatabase} from '../db';
import {seedOrganization} from '../lib/seed';
const d1=createSqliteD1();
try{
 await runWithDatabase(d1,()=>seedOrganization('org_go_fixture'));
 const tables=d1._rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'mes_%' OR name LIKE 'erp_%' OR name LIKE 'pos_%' OR name LIKE 'crm_%' OR name LIKE 'dining_%' OR name LIKE 'shop_%') AND sql LIKE '%organization_id%'").all();
 const translations=JSON.parse(readFileSync('scripts/fixtures-english.json','utf8')) as Record<string,string>;
 const result:Record<string,unknown[]>={};
 for(const {name} of tables){const rows=d1._rawDb.prepare(`SELECT * FROM "${name}" WHERE organization_id=?`).all('org_go_fixture') as Record<string,unknown>[];for(const row of rows)for(const [key,value] of Object.entries(row)){if(typeof value==='string'&&/[\u3400-\u9fff]/u.test(value)){if(!Object.hasOwn(translations,value))throw new Error(`Missing English fixture translation: ${name}.${key}`);row[key]=translations[value];}}if(rows.length)result[name]=rows;}
 writeFileSync('backend/migrations/fixtures.json',JSON.stringify(result,null,2));
 console.log('Exported fictional fixtures:',Object.keys(result).length,'tables');
}finally{d1._rawDb.close();}
