import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/browser',testMatch:['station-dataset-pagination.spec.ts','station-demo-entry.spec.ts'],workers:1,retries:0,use:{baseURL:'http://127.0.0.1:18095',browserName:'chromium',trace:'retain-on-failure'},reporter:[['list']]});
