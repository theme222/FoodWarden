$ErrorActionPreference = 'Stop'
$version = '8.30.1'
$toolDir = Join-Path $PSScriptRoot '../.tools/gitleaks'
New-Item -ItemType Directory -Force $toolDir | Out-Null
$archiveName = "gitleaks_${version}_windows_x64.zip"
$baseUrl = "https://github.com/gitleaks/gitleaks/releases/download/v$version"
$archivePath = Join-Path $toolDir $archiveName
Invoke-WebRequest "$baseUrl/$archiveName" -OutFile $archivePath
$checksumPath = Join-Path $toolDir "checksums.txt"
Invoke-WebRequest "$baseUrl/gitleaks_${version}_checksums.txt" -OutFile $checksumPath
$checksumText = Get-Content -Raw -LiteralPath $checksumPath
$checksumLine = ($checksumText -split "`n" | Where-Object { $_.Trim().EndsWith($archiveName) })
if (@($checksumLine).Count -ne 1) { throw 'Could not resolve the official archive checksum.' }
$expected = ($checksumLine.Trim() -split '\s+')[0]
$actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
if ($actual -ine $expected) { throw 'Gitleaks archive checksum mismatch.' }
Expand-Archive -LiteralPath $archivePath -DestinationPath $toolDir -Force
& (Join-Path $toolDir 'gitleaks.exe') version
if ($LASTEXITCODE -ne 0) { throw 'Gitleaks installation verification failed.' }

