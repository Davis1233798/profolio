const {app,BrowserWindow,session,dialog}=require('electron');
const {spawn}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
let backend,window;
const desktopSmoke=process.env.SUITE_DESKTOP_SMOKE==='1';
if(desktopSmoke&&process.env.SUITE_DESKTOP_SMOKE_DATA)app.setPath('userData',process.env.SUITE_DESKTOP_SMOKE_DATA);
app.enableSandbox();
if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus()}});
async function startBackend(){
 const resources=app.isPackaged?process.resourcesPath:path.resolve(__dirname,'..');
 const binary=app.isPackaged?path.join(resources,'backend','business-suite.exe'):path.join(resources,'outputs','go',process.platform==='win32'?'business-suite.exe':'business-suite');
 const assets=app.isPackaged?path.join(resources,'web'):path.join(resources,'web-dist');
 if(!fs.existsSync(binary))throw new Error('找不到 Go 後端，請先執行 npm run desktop:prepare');
 return new Promise((resolve,reject)=>{backend=spawn(binary,[],{windowsHide:true,env:{...process.env,SUITE_ADDR:'127.0.0.1:0',SUITE_DB:path.join(app.getPath('userData'),'suite.sqlite'),SUITE_WEB:assets},stdio:['ignore','pipe','pipe']});
  const timeout=setTimeout(()=>reject(new Error('Go 後端啟動逾時')),20000);let buffer='';
  const output=data=>{buffer=(buffer+data.toString()).slice(-8192);const match=buffer.match(/Go business-suite ready at (127\.0\.0\.1:\d+)/);if(match){clearTimeout(timeout);resolve('http://'+match[1])}};
  backend.stdout.on('data',output);backend.stderr.on('data',output);backend.once('error',e=>{clearTimeout(timeout);reject(e)});backend.once('exit',code=>{clearTimeout(timeout);if(!window)reject(new Error('Go 後端提前結束：'+code));else if(!app.isQuitting)dialog.showErrorBox('後端連線中斷','請重新啟動 Business Suite。')});
 });
}
app.whenReady().then(async()=>{try{const origin=await startBackend();session.defaultSession.setPermissionRequestHandler((_w,_p,callback)=>callback(false));session.defaultSession.setPermissionCheckHandler(()=>false);
 window=new BrowserWindow({width:1440,height:960,minWidth:360,minHeight:600,title:'Business Suite',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false}});
 window.webContents.setUserAgent(window.webContents.getUserAgent()+' BusinessSuiteDesktop/1.0');
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',(event,url)=>{try{if(new URL(url).origin!==origin)event.preventDefault()}catch{event.preventDefault()}});
 window.webContents.on('will-attach-webview',event=>event.preventDefault());await window.loadURL(origin);window.on('closed',()=>{window=null});
 if(desktopSmoke){
  const waitFor=async(expression)=>{for(let i=0;i<100;i++){if(await window.webContents.executeJavaScript(expression))return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('Desktop smoke timed out: '+expression)};
  await waitFor("document.querySelectorAll('.station-grid a').length===3");
  const links=await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.station-grid a')).map(a=>new URL(a.href).pathname).sort()");
  if(JSON.stringify(links)!==JSON.stringify(['/crm/login','/erp/login','/mes/login']))throw new Error('Unexpected desktop workspace links');
  for(const site of ['mes','erp','crm']){
   await window.loadURL(origin+'/'+site+'/login');await waitFor("document.querySelector('form') !== null");
   const options=await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.system-switch option')).map(o=>o.value).filter(Boolean).sort()");
   if(JSON.stringify(options)!==JSON.stringify(['crm','erp','mes']))throw new Error('Unexpected desktop system switch for '+site);
   for(const role of ['front','admin']){
    if(role==='admin'){await window.loadURL(origin+'/'+site+'/login');await waitFor("document.querySelector('form') !== null")}
    await waitFor("Array.from(document.querySelectorAll('.account-card')).some(b=>b.textContent.includes('"+role+"@suite.test'))");
    await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.account-card')).find(b=>b.textContent.includes('"+role+"@suite.test')).click()");
    await waitFor("document.querySelector('input[type=email]')?.value === '"+role+"@suite.test'");
    await window.webContents.executeJavaScript("document.querySelector('form').requestSubmit()");
    await waitFor("document.querySelector('.station-sidebar') !== null");
    const current=await window.webContents.executeJavaScript("location.pathname");
    if(current!=='/'+site+(role==='admin'?'/back':'/front'))throw new Error('Unexpected '+site+' '+role+' workspace: '+current);
    const hasBack=await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.station-sidebar a')).some(a=>new URL(a.href).pathname === '/"+site+"/back')");
    if(hasBack!==(role==='admin'))throw new Error('Unexpected '+site+' '+role+' back-office access');
    if(role==='admin'){
     await waitFor("document.querySelectorAll('.station-toolbar button').length === 3");
     await window.webContents.executeJavaScript("document.querySelectorAll('.station-toolbar button')[0].click()");
     await waitFor("document.querySelector('.phone-frame iframe')?.contentDocument?.querySelector('.station-main') !== null && !!document.querySelector('.phone-frame iframe')?.contentDocument?.querySelector('.station-main')");
     await window.webContents.executeJavaScript("document.querySelectorAll('.station-toolbar button')[1].click()");
     await waitFor("!!document.querySelector('.workspace-preview')?.contentDocument?.querySelector('.station-main')");
     await window.webContents.executeJavaScript("document.querySelectorAll('.station-toolbar button')[2].click()");
     await waitFor("!!document.querySelector('section.preview-panel.print-preview')");
    }
   }
  }
  await window.loadURL(origin+'/shop/login');await waitFor("document.querySelector('main')?.textContent.includes('available on the web') === true");
  console.log('PASS: Windows desktop workspace scope and login routes');app.quit();
 }

 }catch(e){if(desktopSmoke){console.error(e);if(backend)backend.kill();app.exit(1)}else{dialog.showErrorBox('啟動失敗',e.message);app.quit()}}});
app.on('before-quit',()=>{app.isQuitting=true;if(backend)backend.kill()});app.on('window-all-closed',()=>app.quit());
