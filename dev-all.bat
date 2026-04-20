@echo off
REM BizMech 개발 서버 2개를 각각 새 창에서 동시에 실행

start "BizMech Proxy (Postgres 192.168.0.17)" cmd /k "cd /d "%~dp0bizmech-proxy" && npm run dev"

timeout /t 2 /nobreak >nul

start "BizMech Web (React dev)" cmd /k "cd /d "%~dp0BizMech-web" && npm run dev"

echo.
echo  ✓ Proxy (8080) and Web (5173) started in separate windows.
echo  Close either window to stop that service.
echo.
pause
