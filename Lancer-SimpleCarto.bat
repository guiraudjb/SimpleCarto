@echo off
rem Lance SimpleCarto en local : mini serveur web PowerShell sur http://localhost:8080/
rem Options transmises au script, ex. : Lancer-SimpleCarto.bat -Port 9000 -NoBrowser
title SimpleCarto - serveur local
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serveur\serveur-local.ps1" %*
if errorlevel 1 pause
