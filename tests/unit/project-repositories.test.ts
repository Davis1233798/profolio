import test from 'node:test';
import assert from 'node:assert/strict';
import {projectRepositories} from '../../lib/project-repositories';

test('each business system links to its own public repository',()=>{
 const sites=['mes','erp','pos','crm','dining','shop'] as const;
 assert.deepEqual(Object.keys(projectRepositories).sort(),[...sites].sort());
 assert.equal(new Set(Object.values(projectRepositories)).size,sites.length);
 for(const site of sites) assert.equal(projectRepositories[site],`https://github.com/Davis1233798/business-suite-${site}`);
});
