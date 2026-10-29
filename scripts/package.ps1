$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dist = Join-Path $root 'dist'
$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version = $package.version
$obsoleteOutputs = @(
  (Join-Path $dist "aca-compliance-dashboard-chromium-$version.zip"),
  (Join-Path $dist "aca-compliance-dashboard-firefox-$version.xpi")
)
$outputs = @(
  @{ Source = Join-Path $dist 'chromium\*'; Target = Join-Path $dist "aca-utils-chromium-$version.zip" },
  @{ Source = Join-Path $dist 'firefox\*'; Target = Join-Path $dist "aca-utils-firefox-$version.xpi" },
  @{ Source = Join-Path $dist 'firefox\*'; Target = Join-Path $dist "aca-utils-firefox-$version.zip" }
)

$resolvedDist = [System.IO.Path]::GetFullPath($dist)
$currentTargets = @($outputs | ForEach-Object { [System.IO.Path]::GetFullPath($_.Target) })
$staleOutputs = Get-ChildItem -LiteralPath $dist -File -Filter 'aca-utils-*' -ErrorAction SilentlyContinue
foreach ($staleOutput in $staleOutputs) {
  $resolvedStale = [System.IO.Path]::GetFullPath($staleOutput.FullName)
  if (-not $resolvedStale.StartsWith($resolvedDist, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Stale package target escaped dist: $resolvedStale"
  }
  if ($resolvedStale -notin $currentTargets) {
    Remove-Item -LiteralPath $resolvedStale -Force
  }
}
foreach ($obsoleteOutput in $obsoleteOutputs) {
  $resolvedObsolete = [System.IO.Path]::GetFullPath($obsoleteOutput)
  if (-not $resolvedObsolete.StartsWith($resolvedDist, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Obsolete package target escaped dist: $resolvedObsolete"
  }
  if (Test-Path -LiteralPath $resolvedObsolete) {
    Remove-Item -LiteralPath $resolvedObsolete -Force
  }
}

foreach ($output in $outputs) {
  $resolvedTarget = [System.IO.Path]::GetFullPath($output.Target)
  if (-not $resolvedTarget.StartsWith($resolvedDist, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Package target escaped dist: $resolvedTarget"
  }
  Compress-Archive -Path $output.Source -DestinationPath $resolvedTarget -CompressionLevel Optimal -Force
  Write-Output $resolvedTarget
}
