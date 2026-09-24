import plistlib
import tempfile
import unittest
from pathlib import Path

from package import application_name


class ApplicationNameTests(unittest.TestCase):
    def read_name(self, display_name, filename=None, fallback='EduWork'):
        with tempfile.TemporaryDirectory() as root:
            app = Path(root) / (filename or f'{display_name}.app')
            (app / 'Contents').mkdir(parents=True)
            info = {'CFBundleName': fallback}
            if display_name is not None:
                info['CFBundleDisplayName'] = display_name
            (app / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
            return application_name(app)

    def test_public_institution_and_unicode_names(self):
        for name in ('EduWork', 'EduWork@ECNU', '知识工作台 Demo'):
            with self.subTest(name=name):
                self.assertEqual(self.read_name(name), name)

    def test_falls_back_to_bundle_name(self):
        self.assertEqual(self.read_name(None, 'EduWork.app'), 'EduWork')

    def test_rejects_old_filename_with_new_brand(self):
        with self.assertRaisesRegex(ValueError, 'filename must match'):
            self.read_name('EduWork@ECNU', 'EduWork-ECNU.app')

    def test_rejects_unsafe_volume_names(self):
        for name in ('../other', 'bad:name', 'bad\\name', 'bad\nname', '.', ' padded ', '字' * 100):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.read_name(name, 'fixture.app')


if __name__ == '__main__':
    unittest.main()
