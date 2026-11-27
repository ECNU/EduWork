// Canvas drawing for both the floating pet and the settings preview.
export function createPetPainter(canvas, context, images) {
  const rasters = new Map()
  let drawn

  function source(frame, box, ratio) {
    const image = images.get(frame.file)
    if (!frame.file.toLowerCase().endsWith('.svg')) return { image, crop: frame.crop }
    const key = frame.crop ? `${frame.file}@${frame.crop.x},${frame.crop.y}` : frame.file
    if (!rasters.has(key)) {
      const raster = new OffscreenCanvas(Math.round(box.width * ratio), Math.round(box.height * ratio))
      const crop = frame.crop ?? { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight }
      raster.getContext('2d').drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, raster.width, raster.height)
      rasters.set(key, raster)
    }
    return { image: rasters.get(key), crop: null }
  }

  function draw(frame, box, ratio, pixelated, mirror, motion) {
    const key = [frame.file, frame.crop?.x, frame.crop?.y, mirror, motion.dx, motion.dy, motion.rotate, motion.scaleY].join()
    if (key === drawn) return
    drawn = key
    const pivot = motion.origin === 'top' ? box.y : box.y + box.height, { image, crop } = source(frame, box, ratio)
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.translate(box.x + box.width / 2 + motion.dx, pivot + motion.dy)
    context.rotate(motion.rotate * Math.PI / 180)
    context.scale(mirror ? -1 : 1, motion.scaleY)
    context.translate(-box.width / 2, box.y - pivot)
    context.imageSmoothingEnabled = !pixelated
    if (crop) context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, box.width, box.height)
    else context.drawImage(image, 0, 0, box.width, box.height)
  }

  return { draw, reset() { rasters.clear(); drawn = undefined } }
}
