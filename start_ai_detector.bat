@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo ==========================================
echo ASL Meet Assistant - Local AI Detector
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
        pause
        exit /b 1
    )
)

if not exist "requirements-detection.txt" (
    echo Missing requirements-detection.txt
    pause
    exit /b 1
)
if not exist "asl_letter_model.pkl" (
    echo Missing asl_letter_model.pkl
    pause
    exit /b 1
)
if not exist "mediapipe\hand_landmark_lite.tflite" (
    echo Missing mediapipe\hand_landmark_lite.tflite
    echo Run setup_ai_detector.bat first.
    pause
    exit /b 1
)

%PY% -c "import numpy, sklearn; print('NumPy:', numpy.__version__); print('scikit-learn:', sklearn.__version__)"
if errorlevel 1 (
    echo Required Python packages are not installed.
    echo Run setup_ai_detector.bat first.
    pause
    exit /b 1
)

echo.
echo Starting local ASL model server...
echo Keep this window open while using the extension.
echo Server: http://127.0.0.1:8765

echo.
%PY% ai_detection_server.py
pause
