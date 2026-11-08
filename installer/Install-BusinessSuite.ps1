<#
.SYNOPSIS
  Business Suite 企業版安裝精靈 (Enterprise Setup Wizard)
.DESCRIPTION
  安裝 Business Suite 桌面版至系統，並強制驗證有效企業授權金鑰。
  金鑰無效或已過期將拒絕安裝。
#>

[CmdletBinding()]
param(
    [string]$LicenseKey = "",
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\Business Suite",
    [switch]$Unattended,
    [switch]$Launch
)

$ErrorActionPreference = "Stop"

function Verify-SuiteLicense([string]$key) {
    $trimmed = $key.Trim()
    if (-not $trimmed.StartsWith("BSLIC-V1-")) {
        return @{ Valid = $false; Error = "金鑰格式錯誤（必須以 BSLIC-V1- 為前綴）" }
    }
    $rest = $trimmed.Substring("BSLIC-V1-".Length)
    $parts = $rest.Split('.')
    if ($parts.Length -ne 2) {
        return @{ Valid = $false; Error = "金鑰結構無效（缺少 HMAC 簽章）" }
    }
    $payloadB64 = $parts[0]
    $sigHex = $parts[1]

    $secret = "BUSINESS_SUITE_MASTER_AUTHORITY_KEY_2026_PRODUCTION_SIGNING_SECRET"
    $hmac = New-Object System.Security.Cryptography.HMACSHA256
    $hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($secret)
    $expectedBytes = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($payloadB64))
    $expectedHex = [System.BitConverter]::ToString($expectedBytes).Replace('-', '').ToLower()

    if ($sigHex.ToLower() -ne $expectedHex) {
        return @{ Valid = $false; Error = "金鑰簽章驗證失敗！此金鑰無效或遭到竄改" }
    }

    try {
        $jsonBytes = [System.Convert]::FromBase64String($payloadB64)
        $jsonStr = [System.Text.Encoding]::UTF8.GetString($jsonBytes)
        $payload = $jsonStr | ConvertFrom-Json
    } catch {
        return @{ Valid = $false; Error = "金鑰內容解碼失敗" }
    }

    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $isExpired = $now -gt $payload.expiresAt
    $expDate = [DateTimeOffset]::FromUnixTimeSeconds($payload.expiresAt).ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss")
    $remainingDays = [math]::Max(0, [math]::Floor(($payload.expiresAt - $now) / 86400))

    return @{
        Valid = $true
        IsExpired = $isExpired
        Payload = $payload
        ExpiresDate = $expDate
        RemainingDays = $remainingDays
        RawKey = $trimmed
    }
}

function Perform-Install([hashtable]$licResult, [string]$targetDir, [bool]$launchAfter) {
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "        開始執行 Business Suite 企業版安裝作業              " -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "授權客戶: $($licResult.Payload.customer)" -ForegroundColor Green
    Write-Host "授權等級: $($licResult.Payload.tier)" -ForegroundColor Green
    Write-Host "授權模組: $($licResult.Payload.modules -join ', ')" -ForegroundColor Green
    Write-Host "到期日期: $($licResult.ExpiresDate) (剩餘 $($licResult.RemainingDays) 天)" -ForegroundColor Green
    Write-Host "安裝路徑: $targetDir" -ForegroundColor Yellow

    # 1. Prepare target directory
    if (-not (Test-Path $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }

    # 2. Locate source payload
    $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $PSCommandPath }
    $candidates = @(
        (Join-Path $scriptDir "payload"),
        (Join-Path $scriptDir "..\outputs\desktop\win-unpacked"),
        (Join-Path $scriptDir "..\..\outputs\desktop\win-unpacked")
    )
    $sourceDir = $null
    foreach ($c in $candidates) {
        if (Test-Path (Join-Path $c "Business Suite.exe")) {
            $sourceDir = (Resolve-Path $c).Path
            break
        }
    }

    if (-not $sourceDir) {
        throw "找不到安裝來源檔案（未找到 Business Suite.exe）"
    }

    # Stop any running instances before overwriting
    Get-Process -Name "Business Suite", "business-suite" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    Write-Host "正在自來源目錄複製應用程式檔案: $sourceDir"
    Copy-Item -Path "$sourceDir\*" -Destination $targetDir -Recurse -Force

    # 3. Save license file to AppData
    $appData = [Environment]::GetFolderPath("ApplicationData")
    $suiteDataDir = Join-Path $appData "Business Suite"
    if (-not (Test-Path $suiteDataDir)) {
        New-Item -ItemType Directory -Path $suiteDataDir -Force | Out-Null
    }
    $licFile = Join-Path $suiteDataDir "license.dat"
    [System.IO.File]::WriteAllText($licFile, $licResult.RawKey, [System.Text.Encoding]::UTF8)
    Write-Host "已寫入授權金鑰至: $licFile" -ForegroundColor Green

    # 4. Create Desktop Shortcut
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = Join-Path $desktopPath "Business Suite.lnk"
    $wsh = New-Object -ComObject WScript.Shell
    $shortcut = $wsh.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = Join-Path $targetDir "Business Suite.exe"
    $shortcut.WorkingDirectory = $targetDir
    $shortcut.Description = "Business Suite 企業營運核心管理套件"
    $shortcut.Save()
    Write-Host "已建立桌面捷徑: $shortcutPath" -ForegroundColor Green

    # 5. Create Start Menu Shortcut
    $startMenuPath = Join-Path ([Environment]::GetFolderPath("Programs")) "Business Suite.lnk"
    $smShortcut = $wsh.CreateShortcut($startMenuPath)
    $smShortcut.TargetPath = Join-Path $targetDir "Business Suite.exe"
    $smShortcut.WorkingDirectory = $targetDir
    $smShortcut.Description = "Business Suite 企業營運核心管理套件"
    $smShortcut.Save()
    Write-Host "已建立開始功能表捷徑: $startMenuPath" -ForegroundColor Green

    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "        恭喜！Business Suite 企業版已成功安裝完成           " -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan

    # 6. Launch if requested
    if ($launchAfter) {
        Write-Host "正在啟動 Business Suite..." -ForegroundColor Yellow
        $exe = Join-Path $targetDir "Business Suite.exe"
        Start-Process -FilePath $exe -WorkingDirectory $targetDir
    }
}

# --- UNATTENDED / CLI MODE ---
if ($Unattended -or $LicenseKey) {
    if (-not $LicenseKey) {
        Write-Error "非交談式安裝模式下必須提供 -LicenseKey 參數。"
        exit 1
    }
    $res = Verify-SuiteLicense $LicenseKey
    if (-not $res.Valid) {
        Write-Error "授權金鑰無效: $($res.Error)"
        exit 1
    }
    if ($res.IsExpired) {
        Write-Error "【拒絕安裝】授權金鑰已於 $($res.ExpiresDate) 到期，無法進行安裝。"
        exit 2
    }
    Perform-Install -licResult $res -targetDir $InstallDir -launchAfter $Launch
    exit 0
}

# --- INTERACTIVE GUI SETUP WIZARD ---
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "Business Suite 企業版安裝精靈 (Enterprise Setup)"
$form.Size = New-Object System.Drawing.Size(640, 520)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$form.ForeColor = [System.Drawing.Color]::White

# Title Banner
$titlePanel = New-Object System.Windows.Forms.Panel
$titlePanel.Location = New-Object System.Drawing.Point(0, 0)
$titlePanel.Size = New-Object System.Drawing.Size(640, 75)
$titlePanel.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$form.Controls.Add($titlePanel)

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.Text = "BUSINESS SUITE 企業版安裝精靈"
$titleLabel.Font = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$titleLabel.Location = New-Object System.Drawing.Point(24, 14)
$titleLabel.Size = New-Object System.Drawing.Size(500, 26)
$titleLabel.ForeColor = [System.Drawing.Color]::White
$titlePanel.Controls.Add($titleLabel)

$subTitleLabel = New-Object System.Windows.Forms.Label
$subTitleLabel.Text = "請輸入並驗證您的企業授權金鑰以繼續進行安裝作業"
$subTitleLabel.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$subTitleLabel.Location = New-Object System.Drawing.Point(26, 42)
$subTitleLabel.Size = New-Object System.Drawing.Size(500, 20)
$subTitleLabel.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
$titlePanel.Controls.Add($subTitleLabel)

# License Input Label
$licLabel = New-Object System.Windows.Forms.Label
$licLabel.Text = "授權金鑰 (LICENSE KEY):"
$licLabel.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$licLabel.Location = New-Object System.Drawing.Point(24, 90)
$licLabel.Size = New-Object System.Drawing.Size(300, 22)
$licLabel.ForeColor = [System.Drawing.Color]::FromArgb(226, 232, 240)
$form.Controls.Add($licLabel)

# License Textbox
$licBox = New-Object System.Windows.Forms.TextBox
$licBox.Multiline = $true
$licBox.Location = New-Object System.Drawing.Point(24, 115)
$licBox.Size = New-Object System.Drawing.Size(575, 65)
$licBox.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$licBox.ForeColor = [System.Drawing.Color]::White
$licBox.Font = New-Object System.Drawing.Font("Consolas", 9)
$form.Controls.Add($licBox)

# Verify Button
$verifyBtn = New-Object System.Windows.Forms.Button
$verifyBtn.Text = "驗證授權金鑰"
$verifyBtn.Location = New-Object System.Drawing.Point(24, 188)
$verifyBtn.Size = New-Object System.Drawing.Size(130, 32)
$verifyBtn.BackColor = [System.Drawing.Color]::FromArgb(37, 99, 235)
$verifyBtn.ForeColor = [System.Drawing.Color]::White
$verifyBtn.FlatStyle = "Flat"
$verifyBtn.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($verifyBtn)

# Status Result Box
$statusBox = New-Object System.Windows.Forms.Label
$statusBox.Location = New-Object System.Drawing.Point(24, 230)
$statusBox.Size = New-Object System.Drawing.Size(575, 120)
$statusBox.BackColor = [System.Drawing.Color]::FromArgb(11, 19, 34)
$statusBox.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
$statusBox.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$statusBox.Text = "尚未驗證金鑰。請於上方貼上以 BSLIC-V1- 開頭之授權金鑰並點選【驗證授權金鑰】。"
$form.Controls.Add($statusBox)

# Launch Checkbox
$launchCheck = New-Object System.Windows.Forms.CheckBox
$launchCheck.Text = "安裝完成後立即啟動 Business Suite"
$launchCheck.Location = New-Object System.Drawing.Point(24, 365)
$launchCheck.Size = New-Object System.Drawing.Size(300, 24)
$launchCheck.Checked = $true
$launchCheck.ForeColor = [System.Drawing.Color]::White
$form.Controls.Add($launchCheck)

# Install Button
$installBtn = New-Object System.Windows.Forms.Button
$installBtn.Text = "開始安裝 (Install)"
$installBtn.Location = New-Object System.Drawing.Point(445, 410)
$installBtn.Size = New-Object System.Drawing.Size(155, 40)
$installBtn.BackColor = [System.Drawing.Color]::FromArgb(16, 185, 129)
$installBtn.ForeColor = [System.Drawing.Color]::White
$installBtn.FlatStyle = "Flat"
$installBtn.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$installBtn.Enabled = $false
$form.Controls.Add($installBtn)

# Cancel Button
$cancelBtn = New-Object System.Windows.Forms.Button
$cancelBtn.Text = "取消 (Cancel)"
$cancelBtn.Location = New-Object System.Drawing.Point(325, 410)
$cancelBtn.Size = New-Object System.Drawing.Size(110, 40)
$cancelBtn.BackColor = [System.Drawing.Color]::FromArgb(71, 85, 105)
$cancelBtn.ForeColor = [System.Drawing.Color]::White
$cancelBtn.FlatStyle = "Flat"
$cancelBtn.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$cancelBtn.Add_Click({ $form.Close() })
$form.Controls.Add($cancelBtn)

$global:verifiedLicense = $null

$verifyBtn.Add_Click({
    $keyText = $licBox.Text.Trim()
    if (-not $keyText) {
        $statusBox.ForeColor = [System.Drawing.Color]::FromArgb(248, 113, 113)
        $statusBox.Text = "請輸入授權金鑰。"
        $installBtn.Enabled = $false
        return
    }

    $res = Verify-SuiteLicense $keyText
    if (-not $res.Valid) {
        $statusBox.ForeColor = [System.Drawing.Color]::FromArgb(248, 113, 113)
        $statusBox.Text = "【驗證失敗】" + $res.Error
        $installBtn.Enabled = $false
        return
    }

    if ($res.IsExpired) {
        $statusBox.ForeColor = [System.Drawing.Color]::FromArgb(248, 113, 113)
        $statusBox.Text = "【拒絕安裝】此授權金鑰已於 $($res.ExpiresDate) 到期！`n依照企業安全管理規定，已過期之金鑰無法進行軟體安裝。請聯繫管理員更新授權。"
        $installBtn.Enabled = $false
        return
    }

    $global:verifiedLicense = $res
    $statusBox.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
    $statusBox.Text = "✓ 【金鑰驗證成功】`n" +
        "客戶名稱：$($res.Payload.customer)`n" +
        "授權等級：$($res.Payload.tier)`n" +
        "已購模組：$($res.Payload.modules -join ', ')`n" +
        "有效期限：$($res.ExpiresDate) (有效天數：剩餘 $($res.RemainingDays) 天)`n" +
        "狀態：授權有效，允許進行安裝！"
    $installBtn.Enabled = $true
})

$installBtn.Add_Click({
    if (-not $global:verifiedLicense) { return }
    $installBtn.Enabled = $false
    $verifyBtn.Enabled = $false
    $statusBox.ForeColor = [System.Drawing.Color]::FromArgb(56, 189, 248)
    $statusBox.Text = "正在複製檔案並配置系統捷徑，請稍候..."
    $form.Refresh()

    try {
        Perform-Install -licResult $global:verifiedLicense -targetDir $InstallDir -launchAfter $launchCheck.Checked
        [System.Windows.Forms.MessageBox]::Show(
            "Business Suite 企業版已成功安裝！`n`n已於桌面及開始功能表建立捷徑。`n企業授權金鑰已完成配置。",
            "安裝完成",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        )
        $form.Close()
    } catch {
        [System.Windows.Forms.MessageBox]::Show(
            "安裝過程中發生錯誤：$_",
            "安裝失敗",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        )
        $installBtn.Enabled = $true
        $verifyBtn.Enabled = $true
    }
})

$form.ShowDialog() | Out-Null
