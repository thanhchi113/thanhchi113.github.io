@echo off
chcp 65001 >nul
echo ============================================================
echo   ĐỒNG BỘ VÀ ĐẨY CODE LÊN GITHUB (thanhchi113.github.io)
echo ============================================================

cd /d "%~dp0"

git add .
set /p COMMIT_MSG="Nhập ghi chú commit (mặc định: update): "
if "%COMMIT_MSG%"=="" set COMMIT_MSG=update
git commit -m "%COMMIT_MSG%" 2>nul

git branch -M main
git push -u origin main

if %ERRORLEVEL% equ 0 (
    echo.
    echo [THÀNH CÔNG] Đã đẩy lên: https://thanhchi113.github.io/
) else (
    echo.
    echo [LỖI] Đẩy code thất bại. Vui lòng kiểm tra kết nối mạng.
)
pause
