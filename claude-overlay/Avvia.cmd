@echo off
rem Avvia Claude Overlay con un doppio clic (la prima volta installa i componenti).
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js non e' installato.
  echo Scaricalo da https://nodejs.org ^(versione LTS^), installalo e riapri questo file.
  pause
  exit /b 1
)

if not exist "node_modules\electron\package.json" (
  echo Prima installazione: scarico i componenti, puo' servire qualche minuto...
  call npm install
  if errorlevel 1 (
    echo Installazione non riuscita: controlla la connessione e riprova.
    pause
    exit /b 1
  )
)

rem Electron scarica il suo programma solo quando serve: se manca, lo scarica ora.
if not exist "node_modules\electron\dist\electron.exe" (
  echo Scarico Electron, il motore dell'app ^(circa 100 MB^)...
  node "node_modules\electron\install.js"
  if errorlevel 1 (
    echo Download di Electron non riuscito: controlla la connessione e riprova.
    pause
    exit /b 1
  )
)

start "" "node_modules\electron\dist\electron.exe" .
