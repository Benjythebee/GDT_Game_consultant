# Installs a mod from this folder into Game Dev Tycoon's mods folder.
# By default it creates a directory junction, so edits here are live after restarting the game.
#   .\mods\install.ps1                         # game-consultant, junction
#   .\mods\install.ps1 -Copy                   # copy the files instead
#   .\mods\install.ps1 -GameDir "E:\Games\Game Dev Tycoon"
param(
  [string]$Mod = 'game-consultant',
  [string]$GameDir = 'D:\SteamLibrary\steamapps\common\Game Dev Tycoon',
  [switch]$Copy
)
$ErrorActionPreference = 'Stop'

$source = Join-Path $PSScriptRoot $Mod
$modsDir = Join-Path $GameDir 'mods'
$target = Join-Path $modsDir $Mod
if (-not (Test-Path (Join-Path $source 'package.json'))) { throw "No mod at $source" }
if (-not (Test-Path $modsDir)) { throw "No mods folder at $modsDir. Pass -GameDir with your Game Dev Tycoon folder." }

if (Test-Path $target) {
  $item = Get-Item $target -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    $item.Delete() # removes the junction only, never the files it points to
  } elseif (-not $Copy) {
    throw "$target is a real folder. Remove it yourself or run with -Copy to overwrite its files."
  }
}

if ($Copy) {
  New-Item -ItemType Directory -Force $target | Out-Null
  Copy-Item (Join-Path $source '*') $target -Recurse -Force
  Write-Output "Copied $Mod to $target"
} else {
  New-Item -ItemType Junction -Path $target -Target $source | Out-Null
  Write-Output "Linked $target -> $source"
}
Write-Output 'Start the game, open Mods from the main menu, enable the mod and restart the game.'
