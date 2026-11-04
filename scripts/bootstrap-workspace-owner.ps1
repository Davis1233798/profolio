[CmdletBinding()]
param(
    [string]$HostAlias='oci-jkes-1',
    [pscredential]$Credential
)
$ErrorActionPreference='Stop'
if($HostAlias -notmatch '^[A-Za-z0-9][A-Za-z0-9._@-]{0,200}$'){
    throw 'Use a valid configured SSH host alias.'
}
if(-not $Credential){
    $Credential=Get-Credential -Message 'Choose the workspace owner email and a strong password. Values are sent only through private SSH stdin.'
}
if(-not $Credential){throw 'Owner bootstrap cancelled.'}
$password=$null
$payload=$null
try {
    $email=$Credential.UserName
    try {$address=[System.Net.Mail.MailAddress]::new($email)} catch {throw 'A valid owner email is required.'}
    if($address.Address -ne $email -or $email.Length -gt 254 -or $email -match '[\r\n\x00]'){throw 'Use a plain owner email address.'}
    $password=$Credential.GetNetworkCredential().Password
    if($password.Length -lt 12 -or $password.Length -gt 128 -or $password -match '[\r\n\x00]'){
        throw 'Choose a password of 12-128 characters without line breaks.'
    }
    # Fixed command: neither credential value is interpolated into remote shell text.
    $remoteCommand='cd /srv/business-suite/current/infra && sudo -n docker compose --project-name business-suite --env-file .env -f compose.yaml -f linux/compose.web.yaml exec -T web node /srv/app/operator/workspace-auth-admin.mjs'
    $payload=$email+"`n"+$password
    $global:LASTEXITCODE=0
    $null=$payload | & ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes -- $HostAlias $remoteCommand 2>&1
    if($LASTEXITCODE -ne 0){throw 'Owner bootstrap failed or an owner already exists. No credentials are shown; inspect the private operator setup.'}
    Write-Output 'Owner bootstrap completed. Sign in at /admin/workspace using the supplied credentials.'
} finally {
    $password=$null
    $payload=$null
    $Credential=$null
}