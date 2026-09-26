"""Create a Finder drag-to-install image without changing the signed application."""

import argparse
import plistlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from ds_store import DSStore
from mac_alias import Alias


def run(*args):
    return subprocess.run([str(arg) for arg in args], check=True)


def application_name(app):
    with (app / 'Contents/Info.plist').open('rb') as stream:
        info = plistlib.load(stream)
    return info.get('CFBundleDisplayName') or info.get('CFBundleName') or app.stem


def write_layout(mount, app_name):
    with DSStore.open(str(mount / '.DS_Store'), 'w+') as db:
        db['.']['bwsp'] = {
            'ShowStatusBar': False, 'ShowToolbar': False, 'ShowTabView': False,
            'ShowPathbar': False, 'ShowSidebar': False, 'ContainerShowSidebar': False,
            'PreviewPaneVisibility': False, 'SidebarWidth': 0,
            'WindowBounds': '{{160, 130}, {780, 482}}',
        }
        db['.']['icvp'] = {
            'viewOptionsVersion': 1, 'backgroundType': 2,
            # Finder ignores the view dictionary if these color fields are absent,
            # even when the selected background is an image.
            'backgroundColorRed': 1.0, 'backgroundColorGreen': 1.0,
            'backgroundColorBlue': 1.0,
            'backgroundImageAlias': Alias.for_file(str(mount / '.background/background.png')).to_bytes(),
            'iconSize': 128.0, 'gridSpacing': 100.0, 'gridOffsetX': 0.0,
            'gridOffsetY': 0.0, 'arrangeBy': 'none', 'textSize': 16.0,
            'labelOnBottom': True, 'showItemInfo': False, 'showIconPreview': True,
            'scrollPositionX': 0.0, 'scrollPositionY': 0.0,
        }
        db['.']['vSrn'] = ('long', 1)
        db['.']['icvl'] = ('type', b'icnv')
        db[app_name]['Iloc'] = (220, 226)
        db['Applications']['Iloc'] = (560, 226)


def package(app, output):
    if sys.platform != 'darwin':
        raise RuntimeError('DMG packaging requires macOS')
    name = application_name(app)
    if output.exists() or output.suffix.lower() != '.dmg':
        raise ValueError('Choose a new .dmg output path')
    run('codesign', '--verify', '--deep', '--strict', app)
    output.parent.mkdir(parents=True, exist_ok=True)
    workspace = Path(tempfile.mkdtemp(prefix='eduwork-dmg-', suffix='.noindex'))
    mounted = False
    mount = workspace / 'volume'
    try:
        stage = workspace / 'stage'
        background = stage / '.background/background.png'
        background.parent.mkdir(parents=True)
        run('ditto', '--noextattr', '--noqtn', '--noacl', app, stage / app.name)
        run('codesign', '--verify', '--deep', '--strict', stage / app.name)
        (stage / 'Applications').symlink_to('/Applications')
        (stage / '.metadata_never_index').touch()
        run('xcrun', 'swift', Path(__file__).with_name('background.swift'), background, name)
        rw = workspace / 'installer-rw.dmg'
        run('hdiutil', 'create', '-ov', '-fs', 'HFS+', '-format', 'UDRW',
            '-volname', app.stem, '-srcfolder', stage, rw)
        mount.mkdir()
        run('hdiutil', 'attach', '-nobrowse', '-mountpoint', mount, rw)
        mounted = True
        write_layout(mount, app.name)
        run('hdiutil', 'detach', mount)
        mounted = False
        compressed = workspace / 'installer.dmg'
        run('hdiutil', 'convert', rw, '-format', 'UDZO', '-o', compressed)
        run('hdiutil', 'verify', compressed)
        # Exclusive creation avoids overwriting another build that finished meanwhile.
        with compressed.open('rb') as src:
            dst = output.open('xb')
            try:
                with dst:
                    shutil.copyfileobj(src, dst)
            except BaseException:
                output.unlink(missing_ok=True)
                raise
        print(f'DMG: {output}')
    finally:
        if mounted:
            # Never recurse into a still-mounted volume if ejecting fails.
            result = subprocess.run(['hdiutil', 'detach', str(mount)])
            mounted = result.returncode != 0
        if not mounted:
            shutil.rmtree(workspace)
        else:
            print(f'Could not eject {mount}; build workspace preserved', file=sys.stderr)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    package(args.app.resolve(), args.output.resolve())
