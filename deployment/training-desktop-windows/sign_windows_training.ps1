# Signed Windows release from the exact same-run tested fictional training payload.
# Must run only as a protected, manually approved GitHub Actions dispatch on main.
# Code-signing private material is imported into the ephemeral runner's user store;
# never placed in the installer, source repository, logs, or CLI arguments.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PayloadDir,
    [Parameter(Mandatory = $true)][string]$InstallerScript
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($env:GITHUB_EVENT_NAME -ne 'workflow_dispatch' -or $env:GITHUB_REF -ne 'refs/heads/main') {
    throw 'REFUSED: Windows distribution signing only permits an authorized manual main-branch workflow.'
}
foreach ($key in @('WINDOWS_CODESIGN_PFX_BASE64', 'WINDOWS_CODESIGN_PFX_PASSWORD', 'WINDOWS_CODESIGN_THUMBPRINT')) {
    $secret = [Environment]::GetEnvironmentVariable($key)
    if ([string]::IsNullOrWhiteSpace($secret)) {
        throw "REFUSED: missing Windows signing credential $key (configure the protected training-distribution environment)."
    }
}
$thumbprint = ($env:WINDOWS_CODESIGN_THUMBPRINT -replace '\s', '').ToUpperInvariant()
if ($thumbprint -notmatch '^[0-9A-F]{40}$') {
    throw 'REFUSED: expected a 40-character SHA-1 certificate thumbprint.'
}
if (-not $env:GITHUB_WORKSPACE -or -not $env:RUNNER_TEMP) {
    throw 'REFUSED: Windows signing must run on an isolated GitHub Actions runner.'
}
$workspace = [IO.Path]::GetFullPath($env:GITHUB_WORKSPACE)
$payload = [IO.Path]::GetFullPath($PayloadDir)
$expected = [IO.Path]::GetFullPath((Join-Path $workspace 'dist/desktop'))
if ($payload.TrimEnd('\') -ne $expected.TrimEnd('\')) {
    throw 'REFUSED: signing input must be the extracted same-run training desktop payload.'
}
$scriptPath = [IO.Path]::GetFullPath($InstallerScript)
$expectedScript = [IO.Path]::GetFullPath((Join-Path $workspace 'deployment/training-desktop-windows/installer.iss'))
if ($scriptPath -ne $expectedScript) {
    throw 'REFUSED: only the checked-in training installer project may be compiled.'
}
if (-not (Test-Path $scriptPath -PathType Leaf)) {
    throw 'REFUSED: training installer project is missing.'
}
foreach ($folder in @($payload, (Join-Path $payload 'backend'), (Join-Path $payload 'frontend'))) {
    if (-not (Test-Path $folder -PathType Container)) { throw "REFUSED: packaged training folder missing: $folder" }
}
# Do not follow Windows junctions/symlinks from any downloaded payload.
$reparse = @(Get-ChildItem -LiteralPath $payload -Recurse -Force -Attributes ReparsePoint -ErrorAction Stop)
if ($reparse.Count -gt 0) { throw 'REFUSED: the Windows training payload contains a redirected filesystem link.' }

$controller = Join-Path $payload 'HiddenOasisTraining.exe'
$backend = Join-Path $payload 'backend/training-api/training-api.exe'
$node = Join-Path $payload 'runtime/node.exe'
$frontend = Join-Path $payload 'frontend/standalone/server.js'
foreach ($item in @($controller, $backend, $node, $frontend)) {
    if (-not (Test-Path $item -PathType Leaf)) { throw "REFUSED: Windows training runtime missing: $item" }
}
if ((Get-Item $node).Length -lt 20000000) { throw 'REFUSED: the bundled Node runtime is incomplete.' }

$signtool = Get-ChildItem -Path "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Filter 'signtool.exe' -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $signtool -or -not (Test-Path $signtool)) { throw 'REFUSED: Microsoft SDK SignTool x64 is missing.' }
$iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
if (-not (Test-Path $iscc -PathType Leaf)) { throw 'REFUSED: Inno Setup 6 compiler is missing.' }

# The PFX is an optional exportable code-signing certificate. Some modern
# hardware-backed signing services instead require their own trusted adapter.
# Do not weaken this gate or embed passwords in the SignTool command line.
$pfx = Join-Path $env:RUNNER_TEMP ('training-windows-code-sign-' + [guid]::NewGuid().ToString('N') + '.pfx')
$imported = @()
try {
    $bytes = [Convert]::FromBase64String($env:WINDOWS_CODESIGN_PFX_BASE64)
    [IO.File]::WriteAllBytes($pfx, $bytes)
    [Array]::Clear($bytes, 0, $bytes.Length)
    $pass = ConvertTo-SecureString -String $env:WINDOWS_CODESIGN_PFX_PASSWORD -AsPlainText -Force
    $imported = @(Import-PfxCertificate -FilePath $pfx -CertStoreLocation Cert:\CurrentUser\My -Password $pass -ErrorAction Stop)
    if (-not ($imported | Where-Object { ($_.Thumbprint -replace '\s', '').ToUpperInvariant() -eq $thumbprint -and $_.HasPrivateKey })) {
        throw 'REFUSED: the imported Windows code-signing certificate does not match the approved thumbprint/private key.'
    }
    # Sign the two locally generated entry points. Keep trusted third-party
    # Node/runtime dependencies under their original publisher signatures.
    foreach ($file in @($controller, $backend)) {
        & $signtool sign /sha1 $thumbprint /s My /fd SHA256 /tr 'http://timestamp.digicert.com' /td SHA256 $file
        if ($LASTEXITCODE -ne 0) { throw "REFUSED: Authenticode signing failed for $(Split-Path $file -Leaf)." }
        $signature = Get-AuthenticodeSignature -FilePath $file
        if ($signature.Status -ne 'Valid' -or
            ($signature.SignerCertificate.Thumbprint -replace '\s', '').ToUpperInvariant() -ne $thumbprint -or
            -not $signature.TimeStamperCertificate) {
            throw "REFUSED: Windows runtime signing or timestamp verification failed for $(Split-Path $file -Leaf)."
        }
    }
    $nodeSignature = Get-AuthenticodeSignature -FilePath $node
    if ($nodeSignature.Status -ne 'Valid') {
        # The downloaded Node executable may have an original third-party
        # signature; if invalid/absent, sign our packaged copy rather than
        # requiring trainees to bypass security protection.
        & $signtool sign /sha1 $thumbprint /s My /fd SHA256 /tr 'http://timestamp.digicert.com' /td SHA256 $node
        if ($LASTEXITCODE -ne 0) { throw 'REFUSED: bundled Node signing failed.' }
        $nodeSignature = Get-AuthenticodeSignature -FilePath $node
        if ($nodeSignature.Status -ne 'Valid' -or -not $nodeSignature.TimeStamperCertificate) {
            throw 'REFUSED: bundled Node runtime does not have a valid timestamped signature.'
        }
    }

    # Inno Setup signs *both* the installer and embedded uninstaller / temporary
    # self-copies when SignTool + SignedUninstaller=yes are configured.
    # Do NOT sign just the outer setup.exe after compilation.
    $signCommand = '"' + $signtool + '" sign /sha1 ' + $thumbprint +
        ' /s My /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 $f'
    & $iscc '/DTRAINING_SIGNED_RELEASE=1' ("/Straining_sign=" + $signCommand) $scriptPath
    if ($LASTEXITCODE -ne 0) { throw 'REFUSED: signed Inno Setup compilation failed.' }

    $output = Join-Path $workspace 'dist/installer/Hidden_Oasis_Operations_Training_Windows_Standalone_Setup.exe'
    if (-not (Test-Path $output -PathType Leaf)) { throw 'REFUSED: signed installer output not produced.' }
    $signed = Get-AuthenticodeSignature -FilePath $output
    if ($signed.Status -ne 'Valid' -or
        ($signed.SignerCertificate.Thumbprint -replace '\s', '').ToUpperInvariant() -ne $thumbprint -or
        -not $signed.TimeStamperCertificate) {
        throw 'REFUSED: Windows setup Authenticode signature, identity or RFC3161 timestamp is invalid.'
    }
    & $signtool verify /pa /v $output
    if ($LASTEXITCODE -ne 0) { throw 'REFUSED: Windows installer failed Authenticode verification.' }
    Get-FileHash -Path $output -Algorithm SHA256 | Format-Table -AutoSize
    Write-Host 'PASS: Windows training launcher, backend and installer have validated code signatures; Inno signs uninstallers.'
} finally {
    if (Test-Path $pfx) { Remove-Item -LiteralPath $pfx -Force }
    foreach ($cert in $imported) {
        if (($cert.Thumbprint -replace '\s', '').ToUpperInvariant() -eq $thumbprint) {
            Remove-Item -LiteralPath ('Cert:\CurrentUser\My\' + $cert.Thumbprint) -Force -ErrorAction SilentlyContinue
        }
    }
}
