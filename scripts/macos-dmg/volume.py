"""Attach and normally detach build-owned disk images, tolerating busy volumes."""

import argparse
import plistlib
import re
import subprocess
import time


def attach_image(image, mount, readonly=False):
    args = ['hdiutil', 'attach', '-plist', '-nobrowse', '-mountpoint', str(mount)]
    if readonly:
        args.append('-readonly')
    result = subprocess.run([*args, str(image)], check=True, capture_output=True)
    entities = plistlib.loads(result.stdout).get('system-entities', [])
    for entity in entities:
        device = entity.get('dev-entry', '')
        if re.fullmatch(r'/dev/disk\d+', device):
            return device
    raise RuntimeError('Mounted image has no whole-disk device; preserve workspace')


def detach_image(device, attempts=20):
    if not re.fullmatch(r'/dev/disk\d+', device):
        raise ValueError('Expected the device returned by hdiutil attach')
    for attempt in range(attempts):
        result = subprocess.run(['hdiutil', 'detach', device], capture_output=True)
        if result.returncode == 0:
            return
        # A busy detach may unmount its volume before returning an error. The
        # mount path then disappears; retry the stable device, not that path.
        info = subprocess.run(['hdiutil', 'info', '-plist'], check=True, capture_output=True)
        images = plistlib.loads(info.stdout)['images']
        if not any(entity.get('dev-entry') == device for image in images
                   for entity in image.get('system-entities', [])):
            return
        if attempt + 1 < attempts:
            time.sleep(0.5)
    raise subprocess.CalledProcessError(result.returncode, result.args,
                                       result.stdout, result.stderr)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    attach = commands.add_parser('attach')
    attach.add_argument('image')
    attach.add_argument('mount')
    attach.add_argument('--readonly', action='store_true')
    detach = commands.add_parser('detach')
    detach.add_argument('device')
    args = parser.parse_args()
    if args.command == 'attach':
        print(attach_image(args.image, args.mount, args.readonly))
    else:
        detach_image(args.device)
