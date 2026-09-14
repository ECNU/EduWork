import io
from pathlib import Path
import subprocess
import sys
import unittest
from PIL import Image

RUNNER = Path(__file__).resolve().parents[1] / 'lib' / 'resize-image.py'


class ResizeTest(unittest.TestCase):
    def run_resize(self, size, fit):
        image = Image.new('RGB', (120, 80), 'green')
        image.paste('red', (0, 0, 30, 80))
        image.paste('blue', (90, 0, 120, 80))
        source = io.BytesIO()
        image.save(source, 'PNG')
        result = subprocess.run([sys.executable, '-I', str(RUNNER), size, fit], input=source.getvalue(), capture_output=True, check=True)
        output = Image.open(io.BytesIO(result.stdout))
        output.load()
        return output

    def test_crop_keeps_center_and_fills_target(self):
        result = self.run_resize('80x80', 'crop')
        self.assertEqual(result.size, (80, 80))
        self.assertEqual(result.getpixel((40, 40)), (0, 128, 0, 255))
        self.assertEqual(result.getpixel((0, 40)), (255, 0, 0, 255))
        self.assertEqual(result.getpixel((79, 40)), (0, 0, 255, 255))

    def test_pad_preserves_edges_and_adds_margins(self):
        result = self.run_resize('120x120', 'pad')
        self.assertEqual(result.size, (120, 120))
        self.assertEqual(result.getpixel((60, 0)), (255, 255, 255, 255))
        self.assertEqual(result.getpixel((0, 60)), (255, 0, 0, 255))
        self.assertEqual(result.getpixel((119, 60)), (0, 0, 255, 255))

    def test_requested_landscape_portrait_and_nonstandard_sizes(self):
        for target in ('1200x800', '1080x1920', '1024x768', '600x600'):
            with self.subTest(target=target):
                self.assertEqual(self.run_resize(target, 'crop').size, tuple(map(int, target.split('x'))))


if __name__ == '__main__':
    unittest.main()
