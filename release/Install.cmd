@echo off
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-mcp-bridge.ps1" -Edition public -Client None %*
if errorlevel 1 exit /b 1
echo ToolBraid companion installed. Read README.md to connect your MCP client.
pause
