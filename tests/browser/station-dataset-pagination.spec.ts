import {test,expect} from '@playwright/test';

const items=Array.from({length:500},(_,index)=>({id:`item-${String(index+1).padStart(3,'0')}`,sku:`SKU-${index+1}`,name:`Fixture item ${String(index+1).padStart(3,'0')}`,unit:'each',isActive:true}));
const printLines=Array.from({length:675},(_,index)=>({id:`line-${String(index+1).padStart(3,'0')}`,lineNumber:index+1,description:`Print line ${index+1}`,quantity:1}));
const data={items,warehouses:[{id:'warehouse-1',name:'Fixture warehouse',code:'FIX'}],stockLedger:[],purchaseOrders:[{id:'po-fixture',poNumber:'PO-FIXTURE-1',status:'approved'}],purchaseLines:[],salesOrders:[],salesLines:[],receipts:[],receiptLines:[],invoices:[],suppliers:[{id:'supplier-1',name:'Fixture supplier',isActive:true}],customers:[],journalEntries:[],journalLines:[]};

async function signIn(page:import('@playwright/test').Page){
 await page.route('**/api/stations/erp/data?view=back',route=>route.fulfill({json:{success:true,data}}));
 await page.goto('/erp/login');await page.getByLabel('Email',{exact:true}).fill('admin@suite.test');await page.getByLabel('Password',{exact:true}).fill('SuiteDemo!2026');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL(/\/erp\/back/);
}

test('workspace datasets paginate, search resets the page, and print line details stay complete',async({page})=>{
 await signIn(page);
 const itemsPanel=page.locator('section.dataset').filter({has:page.getByRole('heading',{name:/Items/})});
 await expect(itemsPanel.locator('tbody tr')).toHaveCount(50);
 await expect(itemsPanel.locator('tbody tr').first()).toContainText('item-001');
 const pager=itemsPanel.getByRole('navigation',{name:'Table pagination'});
 await expect(pager).toContainText('Page 1 of 10');
 await pager.getByRole('button',{name:'Next page'}).click();
 await expect(itemsPanel.locator('tbody tr').first()).toContainText('item-051');
 await pager.getByRole('button',{name:'Last page'}).click();
 await expect(pager).toContainText('Page 10 of 10');
 await expect(itemsPanel.locator('tbody tr').first()).toContainText('item-451');

 await page.getByLabel('Search loaded data').fill('Fixture item 051');
 await expect(itemsPanel.locator('tbody tr')).toHaveCount(1);
 await expect(itemsPanel.locator('tbody tr').first()).toContainText('item-051');
 await expect(pager).toContainText('Page 1 of 1');
 await expect(pager.getByRole('button',{name:'Previous page'})).toBeDisabled();

 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);

 await page.route('**/api/stations/erp/print?kind=erp-purchase&id=po-fixture',route=>route.fulfill({json:{success:true,data:{title:'Complete purchase document',record:{id:'po-fixture',poNumber:'PO-FIXTURE-1'},lines:printLines,printedBy:'Fixture admin'}}}));
 await page.getByRole('button',{name:'Labels and print preview'}).click();
 const print=page.locator('.print-preview');
 await print.getByLabel('Print format').selectOption('erp-purchase');
 await print.getByLabel('Document or product').selectOption('po-fixture');
 await print.getByRole('button',{name:'Generate preview'}).click();
 const sheet=page.locator('.print-sheet');
 await expect(sheet.locator('tbody tr')).toHaveCount(675);
 await expect(sheet).toContainText('line-675');
 await expect(sheet.getByRole('navigation',{name:'Table pagination'})).toHaveCount(0);
});

test('preview toggles preserve the current page and pagination controls localize after reload',async({page})=>{
 await signIn(page);
 let itemsPanel=page.locator('section.dataset').filter({has:page.getByRole('heading',{name:/Items/})});
 let pager=itemsPanel.getByRole('navigation',{name:'Table pagination'});
 await expect(itemsPanel.locator('tbody tr')).toHaveCount(50);
 await pager.getByRole('button',{name:'Last page'}).click();
 await expect(pager).toContainText('Page 10 of 10');

 await page.getByRole('button',{name:'Preview front office'}).click();
 await expect(page.getByRole('button',{name:'Close workspace preview'})).toBeVisible();
 await expect(pager).toContainText('Page 10 of 10');
 await page.getByRole('button',{name:'Close workspace preview'}).click();
 await expect(pager).toContainText('Page 10 of 10');

 await page.evaluate(()=>localStorage.setItem('suite-language','zh-TW'));
 await page.reload();
 await expect(page).toHaveURL(/\/erp\/back/);
 itemsPanel=page.locator('section.dataset').filter({has:page.getByRole('heading',{name:/品項/})});
 pager=itemsPanel.getByRole('navigation',{name:'表格分頁'});
 await expect(itemsPanel.locator('tbody tr')).toHaveCount(50);
 await expect(pager.getByRole('button',{name:'下一頁'})).toBeEnabled();
 await expect(pager.getByRole('button',{name:'第一頁'})).toBeDisabled();
});
