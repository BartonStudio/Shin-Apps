# DemoViewer one-shot launcher:
#   1. map asset server  (web/serve.mjs, port 8123) - missing it causes MAP LOAD FAILED
#   2. page dev server   (webapp vite,    port 5173) - exe's webview connects to it
#   3. app               (ShinDemoViewer.exe)
# Running services are NOT started twice. Usage: powershell -File start-dev.ps1

$ErrorActionPreference = 'SilentlyContinue'
$root = $PSScriptRoot
$exe  = Join-Path $root 'build\bin\Debug\ShinDemoViewer.exe'

function Ensure-Port($port, $notListeningAction) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        Write-Host "[OK]      port $port already listening"
        return
    }
    Write-Host "[START]   starting port $port ..."
    & $notListeningAction
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
            Write-Host "[READY]   port $port ready"
            return
        }
    }
    Write-Host "[WARN]    port $port not ready in 15s, check errors above"
}

# 1) map asset server (web/serve.mjs): /maphost /cs2 served from cdn/mirror/
Ensure-Port 8123 {
    Start-Process node -ArgumentList 'serve.mjs' `
        -WorkingDirectory (Join-Path $root 'web') -WindowStyle Hidden
}

# 2) page dev server (webapp vite)
Ensure-Port 5173 {
    Start-Process npm -ArgumentList 'run','dev' `
        -WorkingDirectory (Join-Path $root 'webapp') -WindowStyle Hidden
}

# 3) the app itself
if (Get-Process ShinDemoViewer -ErrorAction SilentlyContinue) {
    Write-Host '[OK]      ShinDemoViewer already running'
} else {
    Start-Process $exe
    Write-Host '[START]   ShinDemoViewer.exe started'
}

Write-Host ''
Write-Host 'All set. MAP LOAD FAILED is almost always step 1 missing.'
