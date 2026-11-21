@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .server-venv\Scripts\pythonw.exe (
  py -3.12 -m venv .server-venv
  if errorlevel 1 goto failed
)
.server-venv\Scripts\python.exe -m pip install -r server\requirements.lock
if errorlevel 1 goto failed
.server-venv\Scripts\python.exe -m server.install_denis
if errorlevel 1 goto failed
.server-venv\Scripts\python.exe -m server.configure_local --check
if errorlevel 1 (
  echo В файле .env укажите LLM_API_KEY для DeepSeek и ASR_API_KEY для Groq.
  echo Сохраните файл, закройте редактор и запустите start-windows.cmd снова.
  notepad .env
  pause
  exit /b 1
)
if exist work\lan-tls\settings.json (
  where node.exe >nul 2>nul
  if errorlevel 1 (
    echo Для локального HTTPS установите Node.js.
    pause
    exit /b 1
  )
  node.exe scripts\start-lan.mjs
  if errorlevel 1 goto failed
) else (
  start "" .server-venv\Scripts\pythonw.exe -m server.windows
)
exit /b 0
:failed
echo Не удалось запустить. Нужен Python 3.12 и подключение к интернету.
pause
