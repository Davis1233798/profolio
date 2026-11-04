$ErrorActionPreference='Stop'
$helper=Join-Path $PSScriptRoot '../scripts/bootstrap-workspace-owner.ps1'
$secret='SyntheticOnly!123456'
$credential=[pscredential]::new('owner@example.test',(ConvertTo-SecureString $secret -AsPlainText -Force))
$global:CapturedSshArguments=@();$global:CapturedSshInput='';$global:TransportExit=0;$global:TransportCalls=0
function global:ssh {
    $global:CapturedSshArguments=@($args)
    $global:CapturedSshInput=(@($input) -join "`n")
    $global:TransportCalls++
    $global:LASTEXITCODE=$global:TransportExit
    'Owner created: synthetic-owner-id'
}
try {
    $output=(& $helper -Credential $credential -HostAlias 'oci-jkes-1') -join "`n"
    if($global:CapturedSshInput -ne "owner@example.test`n$secret"){throw 'Bootstrap stdin must contain exactly email and password'}
    if(($global:CapturedSshArguments -join ' ').Contains($secret) -or $output.Contains($secret)){throw 'Secret escaped stdin transport'}
    if(-not ($global:CapturedSshArguments -contains '-T') -or -not (($global:CapturedSshArguments -join ' ').Contains('StrictHostKeyChecking=yes'))){throw 'SSH transport must be noninteractive and check host identity'}
    $called=$global:TransportCalls
    $rejected=$false
    try { & $helper -Credential $credential -HostAlias 'bad;host' | Out-Null } catch {$rejected=$true}
    if(-not $rejected -or $global:TransportCalls -ne $called){throw 'Invalid host must fail before transport'}
    $weak=[pscredential]::new('owner@example.test',(ConvertTo-SecureString 'short' -AsPlainText -Force))
    $rejected=$false
    try { & $helper -Credential $weak | Out-Null } catch {$rejected=$true}
    if(-not $rejected -or $global:TransportCalls -ne $called){throw 'Invalid password must fail before transport'}
    $global:TransportExit=1
    $rejected=$false
    try { & $helper -Credential $credential | Out-Null } catch {$rejected=$true;if($_.ToString().Contains($secret)){throw 'Failure exposed password'}}
    if(-not $rejected){throw 'Failed remote bootstrap reported success'}
    Write-Output 'Private Windows owner bootstrap boundary passed.'
} finally {
    Remove-Item Function:/ssh -ErrorAction SilentlyContinue
    $global:CapturedSshInput=$null
}