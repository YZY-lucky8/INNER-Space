@echo off
chcp 65001 >nul
title INNERSCAPE · 本地预览服务
cd /d "%~dp0"

set PORT=8765
set PY=

where py >nul 2>nul && set "PY=py -3"
if not defined PY ( where python >nul 2>nul && set "PY=python" )

if not defined PY (
  echo.
  echo  没有找到 Python，无法启动本地服务。
  echo  你可以：装一个 Python 3（勾选 Add to PATH），或用 VS Code 的 Live Server 插件打开 src\index.html。
  echo.
  pause
  exit /b 1
)

echo.
echo  ============================================
echo   INNERSCAPE 本地预览
echo   主站      http://localhost:%PORT%/src/index.html
echo   3D实验室  http://localhost:%PORT%/src/lab/hand3d.html
echo  ============================================
echo.
echo  提示：3D 实验室的摄像头与手部识别必须走这个地址，
echo        直接双击 html 文件（file://）浏览器会禁止调用摄像头。
echo  关闭本窗口即停止服务。
echo.

start "" "http://localhost:%PORT%/src/index.html"
%PY% -m http.server %PORT%

pause
