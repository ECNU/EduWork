import errno
import plistlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import package as dmg


class OutputCleanupTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.app = self.root / 'Example.app'
        (self.app / 'Contents').mkdir(parents=True)
        (self.app / 'Contents/Info.plist').write_bytes(
            plistlib.dumps({'CFBundleName': 'Example'}))
        self.output = self.root / 'Example.dmg'
        for context in [patch.object(dmg.sys, 'platform', 'darwin'),
                        patch.object(dmg, 'write_layout'),
                        patch.object(dmg, 'run', side_effect=self.command)]:
            context.start()
            self.addCleanup(context.stop)

    def command(self, *args):
        if args[:2] == ('hdiutil', 'convert'):
            Path(args[-1]).write_bytes(b'complete-image')

    def test_failed_copy_removes_own_output_and_allows_retry(self):
        failure = OSError(errno.ENOSPC, 'simulated disk full')

        def fail_copy(src, dst):
            dst.write(src.read(4))
            raise failure

        with patch.object(dmg.shutil, 'copyfileobj', side_effect=fail_copy):
            with self.assertRaises(OSError) as raised:
                dmg.package(self.app, self.output)
        self.assertIs(raised.exception, failure)
        self.assertFalse(self.output.exists())
        dmg.package(self.app, self.output)
        self.assertEqual(self.output.read_bytes(), b'complete-image')

    def test_existing_output_is_preserved(self):
        self.output.write_bytes(b'previous-build')
        with self.assertRaises(ValueError):
            dmg.package(self.app, self.output)
        self.assertEqual(self.output.read_bytes(), b'previous-build')

    def test_concurrent_output_is_preserved(self):
        def command(*args):
            self.command(*args)
            if args[:2] == ('hdiutil', 'verify'):
                self.output.write_bytes(b'concurrent-build')

        with patch.object(dmg, 'run', side_effect=command):
            with self.assertRaises(FileExistsError):
                dmg.package(self.app, self.output)
        self.assertEqual(self.output.read_bytes(), b'concurrent-build')


if __name__ == '__main__':
    unittest.main()
