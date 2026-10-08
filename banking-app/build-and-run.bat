@echo off
REM ============================================================
REM  NexaBank – build-and-run.bat
REM  Run this from inside the  banking-app\  directory.
REM ============================================================

echo.
echo [1/3] Detecting JDK...

REM Try JAVA_HOME first
if defined JAVA_HOME (
    set "JAVAC=%JAVA_HOME%\bin\javac.exe"
    set "JAVA=%JAVA_HOME%\bin\java.exe"
    goto :compile
)

REM Fallback: search common install paths (including VS Code bundled JRE)
for %%D in (
    "%USERPROFILE%\.vscode\extensions\redhat.java-1.57.2026092308-win32-x64\jre\21.0.12.1-win32-x86_64"
    "%USERPROFILE%\.vscode\extensions\redhat.java-1.57.2026091908-win32-x64\jre\21.0.12.1-win32-x86_64"
    "%USERPROFILE%\.vscode\extensions\redhat.java-1.57.2026090408-win32-x64\jre\21.0.12.1-win32-x86_64"
    "C:\Program Files\Java"
    "C:\Program Files\Eclipse Adoptium"
    "C:\Program Files\Microsoft"
    "C:\Program Files\Amazon Corretto"
    "%LOCALAPPDATA%\Programs\Eclipse Adoptium"
    "%LOCALAPPDATA%\Programs\Microsoft\jdk"
) do (
    if exist "%%~D" (
        for /d %%J in ("%%~D\*") do (
            if exist "%%~J\bin\javac.exe" (
                set "JAVAC=%%~J\bin\javac.exe"
                set "JAVA=%%~J\bin\java.exe"
                goto :compile
            )
        )
    )
)

echo ERROR: Could not locate javac. Please install a JDK (11+) and set JAVA_HOME.
pause
exit /b 1

:compile
echo     Found: %JAVAC%
echo.
echo [2/3] Compiling Java sources...
if not exist out mkdir out

"%JAVAC%" -d out -sourcepath src ^
    src\com\banking\Main.java ^
    src\com\banking\model\Account.java ^
    src\com\banking\model\Transaction.java ^
    src\com\banking\server\BankingService.java ^
    src\com\banking\server\SimpleHttpServer.java

if errorlevel 1 (
    echo.
    echo ERROR: Compilation failed. See errors above.
    pause
    exit /b 1
)

echo     Compilation successful!
echo.
echo [3/3] Starting NexaBank server...
echo     Open your browser at  http://localhost:8080
echo     Press Ctrl+C to stop.
echo.

"%JAVA%" -cp out com.banking.Main
pause
