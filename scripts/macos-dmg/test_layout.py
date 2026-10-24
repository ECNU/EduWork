"""Cover symlinked mount paths before a full desktop build reaches DMG creation."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import package as dmg


class LayoutPathTest(unittest.TestCase):
    def test_background_alias_uses_the_real_file_path(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            mount = root / 'volume'
            background = mount / '.background/background.png'
            background.parent.mkdir(parents=True)
            background.write_bytes(b'fixture')
            shortcut = root / 'shortcut'
            shortcut.symlink_to(mount, target_is_directory=True)
            alias = Mock()
            alias.to_bytes.return_value = b'alias-test-data'
            with patch.object(dmg.Alias, 'for_file', return_value=alias) as create_alias:
                dmg.write_layout(shortcut, 'Example.app')
            create_alias.assert_called_once_with(str(background.resolve(strict=True)))
            with dmg.DSStore.open(str(mount / '.DS_Store'), 'r') as db:
                self.assertEqual(db['.']['icvp']['backgroundImageAlias'], b'alias-test-data')


@unittest.skipUnless(sys.platform == 'darwin', 'requires native macOS HFS+ image')
class NativeLayoutTest(unittest.TestCase):
    def test_alias_stays_inside_image_through_a_symlinked_mount(self):
        # A tiny real HFS+ image reproduces /var versus /private/var without
        # needing Electron or the full product. Preserve a busy mounted image.
        root = Path(tempfile.mkdtemp(prefix='eduwork-dmg-layout-')).resolve()
        image, mount, shortcut = root / 'test.dmg', root / 'volume', root / 'shortcut'
        device = None
        mounted = False
        try:
            # Leave room for hdiutil's default partition layout as well as HFS+.
            # Blank images are writable by default; -format requires a source.
            subprocess.run(['hdiutil', 'create', '-size', '64m', '-fs', 'HFS+',
                            '-volname', 'Layout Test', str(image)],
                           check=True)
            mount.mkdir()
            mounted = True
            device = dmg.attach_image(image, mount)
            background = mount / '.background/background.png'
            background.parent.mkdir()
            background.write_bytes(b'alias target fixture')
            shortcut.symlink_to(mount, target_is_directory=True)
            dmg.write_layout(shortcut, 'Example.app')
            with dmg.DSStore.open(str(mount / '.DS_Store'), 'r') as db:
                settings = db['.']['icvp']
                alias = dmg.Alias.from_bytes(settings['backgroundImageAlias'])
                self.assertEqual(alias.target.posix_path, '/.background/background.png')
                self.assertEqual(tuple(alias.target.cnid_path), (background.parent.stat().st_ino,))
                self.assertEqual(alias.target.cnid, background.stat().st_ino)
                self.assertEqual(db['Example.app']['Iloc'], (220, 226))
            # Reopen the image at a different path, as a user's Finder will.
            dmg.detach_image(device)
            device = None
            mounted = False
            relocated = root / 'relocated'
            relocated.mkdir()
            mounted = True
            device = dmg.attach_image(image, relocated, readonly=True)
            with dmg.DSStore.open(str(relocated / '.DS_Store'), 'r') as db:
                alias = dmg.Alias.from_bytes(db['.']['icvp']['backgroundImageAlias'])
                target = relocated / alias.target.posix_path.lstrip('/')
                self.assertEqual(target.read_bytes(), b'alias target fixture')
                self.assertEqual(alias.target.cnid, target.stat().st_ino)
        finally:
            if device:
                dmg.detach_image(device)
                mounted = False
            # An ambiguous/failed attach may leave a mounted volume behind.
            if not mounted:
                dmg.shutil.rmtree(root)


if __name__ == '__main__':
    unittest.main()
