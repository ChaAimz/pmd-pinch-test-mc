# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for pinch-tray.exe  (PySide6 build)
#
# Output location: C:\pinch-test-mc\pinch-tray.exe
#
# Build with:
#   tray\build.bat
# or manually:
#   cd tray
#   pyinstaller pinch_tray.spec
#
# The --distpath is supplied by build.bat (CLI flag).
# This spec is --onefile / --windowed (no console window).

block_cipher = None

import os
from pathlib import Path

# Detect assets directory relative to this spec file
_SPEC_DIR = os.path.dirname(os.path.abspath(SPEC))
_ASSETS   = os.path.join(_SPEC_DIR, "assets")

a = Analysis(
    ['pinch_tray.py'],
    pathex=[],
    binaries=[],
    datas=[
        # Bundle all assets (icons, splash) beside the exe under 'assets/'
        (_ASSETS, 'assets'),
    ],
    hiddenimports=[
        # PySide6 platform plugin (Windows: qwindows.dll)
        'PySide6.QtWidgets',
        'PySide6.QtGui',
        'PySide6.QtCore',
        'PySide6.plugins.platforms.qwindows',
        'PySide6.plugins.styles.qwindowsvistastyle',
        # psutil Windows backend
        'psutil._pswindows',
        # stdlib internals PyInstaller sometimes misses
        'urllib.request',
        'urllib.error',
        'configparser',
        'winreg',
        'threading',
        'logging.handlers',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude heavy libs not used at runtime
        'tkinter',
        'matplotlib',
        'numpy',
        'scipy',
        'pandas',
        'IPython',
        'jupyter',
        'pytest',
        # Old tray stack (no longer used)
        'pystray',
        'PIL',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='pinch-tray',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,               # UPX can break on some AV; keep off for reliability
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,           # --windowed / noconsole: no black cmd window
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=os.path.join(_ASSETS, 'icon.ico'),
)
