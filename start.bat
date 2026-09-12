@echo off
setlocal

cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$client = New-Object System.Net.Sockets.TcpClient; try { $client.Connect('localhost', 3000); exit 0 } catch { exit 1 } finally { $client.Dispose() }"
if errorlevel 1 (
	echo Starting Assertion Creator at http://localhost:3000
	start "Assertion Creator Server" /D "%~dp0" cmd /k npm start
	timeout /t 2 /nobreak >nul
) else (
	echo Assertion Creator is already running at http://localhost:3000
)

start "" "http://localhost:3000"

endlocal