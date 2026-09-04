@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ==========================================
echo ASL Meet Assistant - AI Detector Setup
echo ==========================================
echo.

where py >nul 2>&1
if %errorlevel%==0 (
    set "PY=py -3"
) else (
    where python >nul 2>&1
    if %errorlevel%==0 (
        set "PY=python"
    ) else (
        echo Python 3 was not found.
        echo Install Python 3.11 and run this file again.
        pause
        exit /b 1
    )
)

echo Checking Python and detector dependencies...
%PY% -m pip install -r requirements-detection.txt
if errorlevel 1 (
    echo.
    echo Python dependency installation failed.
    echo Check the error above.
    pause
    exit /b 1
)

echo.
echo Checking the local MediaPipe browser model...
if exist "mediapipe\hand_landmark_lite.tflite" (
    echo MediaPipe hand model already present.
) else (
    echo The previous package was missing hand_landmark_lite.tflite.
    echo Downloading the official MediaPipe asset once...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$u='https://storage.googleapis.com/mediapipe-assets/hand_landmark_lite.tflite'; $o=Join-Path $PWD 'mediapipe\hand_landmark_lite.tflite'; Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile $o"
    if errorlevel 1 (
        echo.
        echo Could not download the MediaPipe hand model.
        echo Check your internet connection and run setup_ai_detector.bat again.
        pause
        exit /b 1
    )
)

if not exist "mediapipe\hand_landmark_lite.tflite" (
    echo MediaPipe hand model is still missing.
    pause
    exit /b 1
)

echo.
echo Setup complete.
echo.
echo Required local files verified:
echo   - asl_letter_model.pkl
necho   - mediapipe\hand_landmark_lite.tflite
echo   - mediapipe\hands.js
necho.
echo Now run start_ai_detector.bat and keep it open.
pause
