param(
    [Parameter(Mandatory = $true)]
    [string] $profilePath
)

$ErrorActionPreference = 'Stop'
try {
    $resolvedProfile = (Resolve-Path -LiteralPath $profilePath).Path
    $packagePath = Join-Path $resolvedProfile 'package.json'
    $patchPath = Join-Path $resolvedProfile 'cordis.patch.yml'
    $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    if (-not $package.dependencies.'dsh-world') {
        throw 'Install the built dsh-world package in this profile before enabling its compaction backend.'
    }
    $content = [System.IO.File]::ReadAllText($patchPath)
    if ($content -match '(?m)^\s*name:\s*[''"'']?dsh-world/compaction[''"'']?\s*$') {
        Write-Output 'Tool-free compaction is already configured.'
        return
    }
    $pattern = '(?m)^(\s*name:\s*)([''"'']?)@deepseek-ai/dsh-compaction-basic\2([ \t]*(?:#.*)?\r?)$'
    $matchesFound = [regex]::Matches($content, $pattern)
    if ($matchesFound.Count -ne 1) {
        throw "Expected exactly one explicit compaction-basic entry in cordis.patch.yml; found $($matchesFound.Count). No configuration was changed."
    }
    $updated = [regex]::Replace($content, $pattern, '${1}''dsh-world/compaction''${3}')
    $backupPath = "$patchPath.dsh-world.$([Guid]::NewGuid().ToString('N')).bak"
    $temporaryPath = "$patchPath.$([Guid]::NewGuid().ToString('N')).tmp"
    [System.IO.File]::WriteAllText($temporaryPath, $updated, [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::Replace($temporaryPath, $patchPath, $backupPath)
    Write-Output "Configured tool-free compaction. Restart this DSH profile to load it. Backup: $backupPath"
} catch {
    throw "Cannot configure dsh-world compaction: $($_.Exception.Message)"
}
