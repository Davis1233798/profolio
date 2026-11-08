import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function run(cmd, args, options = {}) {
  const isWinCmd = process.platform === 'win32' && (cmd.endsWith('.cmd') || cmd.endsWith('.bat'));
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: isWinCmd,
    ...options
  });
  if (r.status !== 0) {
    process.exit(r.status || 1);
  }
}

console.log('[package-desktop] Building Rust desktop binaries (supervisor + license-keygen)...');
run('cargo', ['build', '--release', '--manifest-path', 'desktop/Cargo.toml']);

const outputDir = path.resolve('outputs/desktop/win-unpacked');
const resourcesDir = path.join(outputDir, 'resources');
const backendDir = path.join(resourcesDir, 'backend');
const webDir = path.join(resourcesDir, 'web');

mkdirSync(backendDir, { recursive: true });
mkdirSync(webDir, { recursive: true });

const rustBin = path.resolve('desktop/target/release/business-suite-desktop.exe');
const targetExe = path.join(outputDir, 'Business Suite.exe');
if (existsSync(rustBin)) {
  console.log(`[package-desktop] Copying ${rustBin} -> ${targetExe}`);
  cpSync(rustBin, targetExe);
} else {
  console.error(`[package-desktop] Error: Rust binary not found at ${rustBin}`);
  process.exit(1);
}

const goBin = path.resolve('outputs/go/business-suite.exe');
if (existsSync(goBin)) {
  console.log(`[package-desktop] Copying ${goBin} -> ${path.join(backendDir, 'business-suite.exe')}`);
  cpSync(goBin, path.join(backendDir, 'business-suite.exe'));
} else {
  console.warn(`[package-desktop] Warning: Go binary not found at ${goBin}`);
}

const webDist = path.resolve('web-dist');
if (existsSync(webDist)) {
  console.log(`[package-desktop] Copying ${webDist} -> ${webDir}`);
  cpSync(webDist, webDir, { recursive: true });
} else {
  console.warn(`[package-desktop] Warning: web-dist not found at ${webDist}`);
}

// ---------------------------------------------------------------------------
// Build Self-Contained Installer Distribution Package
// ---------------------------------------------------------------------------
const installerPackageDir = path.resolve('outputs/installer-package');
mkdirSync(installerPackageDir, { recursive: true });
const installerPayloadDir = path.join(installerPackageDir, 'payload');
const installerToolsDir = path.join(installerPackageDir, 'tools');
mkdirSync(installerPayloadDir, { recursive: true });
mkdirSync(installerToolsDir, { recursive: true });

console.log('[package-desktop] Building installer distribution package...');
cpSync(outputDir, installerPayloadDir, { recursive: true });

// Copy Installer files
const setupBat = path.resolve('installer/Setup.bat');
const setupPs1 = path.resolve('installer/Install-BusinessSuite.ps1');
if (existsSync(setupBat)) {
  cpSync(setupBat, path.join(installerPackageDir, 'Setup.bat'));
}
if (existsSync(setupPs1)) {
  cpSync(setupPs1, path.join(installerPackageDir, 'Install-BusinessSuite.ps1'));
}

// Copy license-keygen binary
const keygenBin = path.resolve('desktop/target/release/license-keygen.exe');
if (existsSync(keygenBin)) {
  cpSync(keygenBin, path.join(installerToolsDir, 'license-keygen.exe'));
  cpSync(keygenBin, path.join(outputDir, 'license-keygen.exe'));
}

// Generate sample keys using license-keygen
const genKey = (args) => {
  const res = spawnSync(keygenBin, args, { encoding: 'utf8' });
  const lines = res.stdout.split('\n');
  const keyLine = lines.find(l => l.startsWith('BSLIC-V1-'));
  return keyLine ? keyLine.trim() : '';
};

const fullSuiteKey = genKey(['--customer', '台灣先進智能製造股份有限公司', '--days', '365', '--modules', 'erp,mes,crm,shop,pos,dining']);
const partialKey = genKey(['--customer', '新竹智能機械股份有限公司', '--days', '180', '--modules', 'mes,erp']);
const expiredKey = genKey(['--customer', '到期示範企業股份有限公司', '--expired', '--modules', 'all']);

const readmeContent = `================================================================================
BUSINESS SUITE 企業版安裝與授權說明 (Enterprise Installation & License Guide)
================================================================================

本安裝包包含完整 Business Suite 企業級桌面應用程式、授權驗證安裝精靈與金鑰產生器。

【安裝方式】
1. 雙擊執行 "Setup.bat" 啟動圖形安裝精靈。
2. 於精靈畫面貼入授權金鑰並點選【驗證授權金鑰】。
3. 驗證通過後點選【開始安裝】，程式將自動安裝至本機並建立桌面捷徑。

--------------------------------------------------------------------------------
【快速測試授權金鑰清單】
--------------------------------------------------------------------------------

1. [旗艦全模組授權 - 365天有效] (包含 MES, ERP, CRM, Shop, POS, Dining 全部六大模組)
客戶名稱：台灣先進智能製造股份有限公司
授權等級：enterprise_unlimited
金鑰 (請整行複製)：
${fullSuiteKey}

2. [部分模組授權 - 180天有效] (僅授權 MES 與 ERP 模組；其餘模組將於門戶中鎖定)
客戶名稱：新竹智能機械股份有限公司
授權等級：enterprise_unlimited
金鑰 (請整行複製)：
${partialKey}

3. [已過期金鑰 - 測試用] (安裝精靈將攔截拒絕安裝；若於運行中套用將觸發資料鎖定與自解除安裝)
客戶名稱：到期示範企業股份有限公司
狀態：已過期 (EXPIRED)
金鑰 (請整行複製)：
${expiredKey}

--------------------------------------------------------------------------------
【金鑰產生器 (License Key Generator)】
如需為不同客戶或客製模組生成專屬金鑰，可執行 tools/license-keygen.exe：
  .\\tools\\license-keygen.exe --customer "客戶名稱" --days 365 --modules "erp,mes"
================================================================================
`;

writeFileSync(path.join(installerPackageDir, 'README_LICENSE.txt'), readmeContent, 'utf8');

console.log('[package-desktop] Successfully packaged Rust desktop application to:', outputDir);
console.log('[package-desktop] Successfully built Installer Package to:', installerPackageDir);
