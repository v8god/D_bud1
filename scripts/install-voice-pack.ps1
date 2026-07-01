param(
    [Parameter(Mandatory = $true)]
    [string]$SourceFolder,
    [string]$PackName = "My pre-generated custom voice",
    [string]$Language = "en-IN"
)

$ErrorActionPreference = "Stop"
$source = (Resolve-Path $SourceFolder).Path
$destination = Join-Path $PSScriptRoot "..\public\assets\voice-packs\custom"
New-Item -ItemType Directory -Path $destination -Force | Out-Null

$allowed = @(".wav", ".mp3", ".ogg", ".m4a")
$clips = [ordered]@{}

Get-ChildItem -Path $source -File | ForEach-Object {
    if ($allowed -notcontains $_.Extension.ToLowerInvariant()) { return }
    $clipId = $_.BaseName
    if ($clipId -notmatch '^[a-z0-9][a-z0-9-]*$') {
        throw "Invalid clip filename '$($_.Name)'. Use response IDs such as hello.wav or continuous-morning.mp3."
    }
    Copy-Item $_.FullName (Join-Path $destination $_.Name) -Force
    $clips[$clipId] = $_.Name
}

if ($clips.Count -eq 0) {
    throw "No WAV, MP3, OGG, or M4A files were found in $source"
}

$manifest = [ordered]@{
    id = "custom-fixed-responses"
    name = $PackName
    language = $Language
    clips = $clips
}

$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $destination "manifest.json") -Encoding UTF8
Write-Host "Installed $($clips.Count) custom response clips in $destination"
Write-Host "Restart Desktop Buddy or reload the app before testing the updated pack."
