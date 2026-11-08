@echo off
setlocal
cd /d "%~dp0"
title Business Suite 企業版安裝精靈
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-BusinessSuite.ps1" %*
endlocal
