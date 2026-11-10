import {writeFile} from 'node:fs/promises';
import {emptySchemaSql} from '../server/migrations.js';
await writeFile(new URL('../db/schema.sql',import.meta.url),await emptySchemaSql(),'utf8');
console.log('db/schema.sql generated: structure and default settings only, no local database access or data export.');
