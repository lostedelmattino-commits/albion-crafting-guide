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

rem Electron 45 richiede Node.js 22.12 o successivo.
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)"
if errorlevel 1 (
  echo Serve Node.js 22.12 o successivo: aggiornalo da https://nodejs.org ^(versione LTS^).
  pause
  exit /b 1
)

rem Componenti da installare o aggiornare se package.json e' cambiato (es. dopo un aggiornamento).
fc /b "package.json" "node_modules\.overlay-package.json" >nul 2>nul
if errorlevel 1 (
  echo Installo i componenti, puo' servire qualche minuto...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Installazione non riuscita: controlla la connessione e riprova.
    pause
    exit /b 1
  )
  copy /y "package.json" "node_modules\.overlay-package.json" >nul
)

rem Electron scarica il suo programma solo quando serve: path.txt viene scritto alla fine del download.
if not exist "node_modules\electron\path.txt" (
  echo Scarico Electron, il motore dell'app ^(circa 100 MB^)...
  node "node_modules\electron\install.js"
  if errorlevel 1 (
    echo Download di Electron non riuscito: controlla la connessione e riprova.
    pause
    exit /b 1
  )
)

start "" "node_modules\electron\dist\electron.exe" .
