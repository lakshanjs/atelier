# Builds vdesk.node next to this script with Visual Studio's C compiler. It needs no Windows SDK: the import libraries for
# the few Windows functions it uses are made here from their names. Exits non-zero if it can't build.
$ErrorActionPreference = 'Stop'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) { exit 2 }
$vs = & $vswhere -all -products * -latest -property installationPath | Select-Object -First 1
$msvc = Get-ChildItem (Join-Path $vs 'VC\Tools\MSVC') -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
if (-not $msvc) { exit 3 }
$bin = Join-Path $msvc.FullName 'bin\Hostx64\x64'
$work = Join-Path $env:TEMP ('vdesk-' + [guid]::NewGuid().ToString('N')); New-Item -ItemType Directory $work | Out-Null
try {
  "LIBRARY kernel32.dll`nEXPORTS`n GetModuleHandleW`n GetProcAddress`n MultiByteToWideChar" | Set-Content (Join-Path $work 'k.def') -Encoding ascii
  "LIBRARY ole32.dll`nEXPORTS`n CoInitializeEx`n CoCreateInstance`n CLSIDFromString" | Set-Content (Join-Path $work 'o.def') -Encoding ascii
  $env:PATH = "$bin;$env:PATH"
  & lib.exe /nologo /machine:x64 /def:"$work\k.def" /out:"$work\k.lib" | Out-Null; if ($LASTEXITCODE) { exit 4 }
  & lib.exe /nologo /machine:x64 /def:"$work\o.def" /out:"$work\o.lib" | Out-Null; if ($LASTEXITCODE) { exit 4 }
  & cl.exe /nologo /c /O2 /GS- /Zl /W3 (Join-Path $PSScriptRoot 'vdesk.c') /Fo"$work\vdesk.obj" | Out-Null; if ($LASTEXITCODE) { exit 5 }
  & link.exe /nologo /DLL /NOENTRY /NODEFAULTLIB /OUT:"$work\vdesk.node" "$work\vdesk.obj" "$work\k.lib" "$work\o.lib" | Out-Null; if ($LASTEXITCODE) { exit 6 }
  Copy-Item "$work\vdesk.node" (Join-Path $PSScriptRoot 'vdesk.node') -Force
} finally { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
exit 0
