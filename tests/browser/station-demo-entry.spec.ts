import {test,expect} from '@playwright/test';

for(const site of ['mes','erp','pos','crm','dining','shop']){
 test(`${site} exposes back-office and front-office demos through explicit role login`,async({page})=>{
  test.setTimeout(60_000);
  await page.goto(`/${site}/login?view=back`);
  await expect(page).toHaveURL(new RegExp(`/${site}/login\\?view=back$`));
  await page.getByRole('button',{name:'Enter demo as Administrator',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/${site}/back$`));
  const identity=(await(await page.request.get(`/api/auth/me?site=${site}`)).json()).data;
  expect(identity.grants).toContainEqual(expect.objectContaining({site,role:'admin',scope:'back',enabled:true}));
  await expect(page.getByRole('button',{name:'Labels and print preview',exact:true})).toBeVisible();
  await page.screenshot({path:`outputs/browser/station-demo/${site}-back.png`,fullPage:false});
  await page.getByRole('button',{name:'Mobile preview',exact:true}).click();
  await expect(page.locator('iframe')).toHaveCount(1);
  await page.getByRole('button',{name:'Close mobile preview',exact:true}).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button',{name:'Labels and print preview',exact:true}).click();
  await expect(page.locator('.print-preview')).toBeVisible();
  await page.getByRole('button',{name:'Close print preview',exact:true}).click();
  await page.goto(`/${site}/login?view=front`);
  await page.getByRole('button',{name:'Enter demo as Front-office operator',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/${site}/front$`));
  expect((await page.request.get(`/api/stations/${site}/data?view=back`)).status()).toBe(403);
 });
}

test('read-only demo stays restricted and the demo chooser localizes',async({page})=>{
 await page.goto('/erp/login?view=back');
 await page.getByRole('button',{name:'Enter demo as Read-only viewer',exact:true}).click();
 await expect(page).toHaveURL(/\/erp\/back$/);
 expect((await page.request.get('/api/stations/erp/users')).status()).toBe(403);
 await page.goto('/erp/login?view=back');
 await page.getByLabel('Language',{exact:true}).selectOption('zh-TW');
 await expect(page.getByRole('button',{name:'以管理員體驗',exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:'outputs/browser/station-demo/erp-login-mobile-zh.png',fullPage:false});
});

const localizedDatasets = {
 mes: [
  ['finishedGoodsBatches', 'Finished goods batches', '成品批次'],
  ['finishedGoodsQualityDispositions', 'Finished goods quality dispositions', '成品品質處置'],
  ['finishedGoodsResolutions', 'Finished goods resolutions', '成品處理結果'],
  ['finishedGoodsInventory', 'Finished goods inventory', '成品庫存'],
  ['finishedGoodsReceipts', 'Finished goods receipts', '成品入庫紀錄'],
 ],
 crm: [['stages', 'Sales stages', '銷售階段']],
 dining: [
  ['modifierGroups', 'Modifier groups', '餐點選項群組'],
  ['modifierOptions', 'Modifier options', '餐點選項'],
  ['locations', 'Locations', '營業據點'],
  ['sessions', 'Table sessions', '用餐場次'],
  ['kitchenTickets', 'Kitchen tickets', '廚房出餐單'],
  ['billSummaries', 'Bill summaries', '帳單摘要'],
 ],
};

for (const [site, datasets] of Object.entries(localizedDatasets)) {
 test(`${site} renders dataset navigation in both languages`, async ({page}) => {
  test.setTimeout(60_000);
  for (const locale of ['en', 'zh-TW']) {
   await page.goto(`/${site}/login?view=back`);
   if (locale === 'zh-TW') {
    await page.getByLabel('Language', {exact: true}).selectOption(locale);
   }
   await page.getByRole('button', {
    name: locale === 'en' ? 'Enter demo as Administrator' : '以管理員體驗',
    exact: true,
   }).click();
   await expect(page).toHaveURL(new RegExp(`/${site}/back$`));
   for (const [key, english, chinese] of datasets) {
    const label = locale === 'en' ? english : chinese;
    await expect(page.locator(`.station-sidebar a[href="/${site}/back?dataset=${key}"]`)).toHaveText(label);
    await expect(page.locator('.dataset').getByRole('heading', {name: label, exact: true})).toBeVisible();
   }
  }
 });
}
