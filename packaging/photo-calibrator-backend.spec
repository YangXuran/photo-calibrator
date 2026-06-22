from pathlib import Path

from PyInstaller.utils.hooks import collect_all


repo_root = Path(SPECPATH).resolve().parent
datas = []
binaries = []
hiddenimports = []

for package in ("cv2", "rawpy", "imageio", "tifffile", "OpenImageIO", "PyOpenColorIO"):
    package_datas, package_binaries, package_hiddenimports = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hiddenimports

analysis = Analysis(
    [str(repo_root / "packaging" / "backend_entry.py")],
    pathex=[str(repo_root / "src")],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hooksconfig={},
    runtime_hooks=[],
    excludes=["torch", "matplotlib", "pytest"],
    noarchive=False,
)
pyz = PYZ(analysis.pure)

exe = EXE(
    pyz,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="photo-calibrator-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    target_arch="arm64",
    codesign_identity=None,
    entitlements_file=None,
)

collect = COLLECT(
    exe,
    analysis.binaries,
    analysis.datas,
    strip=False,
    upx=False,
    name="photo-calibrator-backend",
)
