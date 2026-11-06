# Prints the id of virtual desktop number $Number (1 is the first in Task View), or nothing if there isn't one.
# Windows keeps the desktops in order in the registry.
param([int]$Number = 1)
$k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VirtualDesktops'
$b = (Get-ItemProperty $k -ErrorAction SilentlyContinue).VirtualDesktopIDs
if (-not $b -or $Number -lt 1 -or $b.Length -lt $Number * 16) { exit 0 }
$i = ($Number - 1) * 16
[Guid]::new([byte[]]$b[$i..($i + 15)]).ToString('B')
