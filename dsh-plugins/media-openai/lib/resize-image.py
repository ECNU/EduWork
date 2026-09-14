"""Resize generated image bytes using the deployment's existing Pillow runtime."""
import io
import sys
import warnings

from PIL import Image, ImageOps


def main():
    width, height = map(int, sys.argv[1].split('x'))
    fit = sys.argv[2]
    if not (64 <= width <= 4096 and 64 <= height <= 4096) or fit not in ('crop', 'pad'):
        raise ValueError('invalid output dimensions or fit')
    Image.MAX_IMAGE_PIXELS = 4096 * 4096
    warnings.simplefilter('error', Image.DecompressionBombWarning)
    with Image.open(io.BytesIO(sys.stdin.buffer.read(32 * 1024 * 1024))) as original:
        image = ImageOps.exif_transpose(original).convert('RGBA')
        if fit == 'pad':
            output = ImageOps.pad(image, (width, height), method=Image.Resampling.LANCZOS, color=(255, 255, 255, 255))
        else:
            output = ImageOps.fit(image, (width, height), method=Image.Resampling.LANCZOS)
        output.save(sys.stdout.buffer, format='PNG')


if __name__ == '__main__':
    main()
