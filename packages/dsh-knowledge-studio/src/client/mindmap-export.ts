import {mindmapPNGSize} from '../../lib/mindmap.js'

/** Rasterize the full exported SVG, never the interactive viewport. */
export async function mindmapPNG(svg:Blob):Promise<Blob> {
  await document.fonts.ready
  const url=URL.createObjectURL(svg)
  try {
    const image=new Image()
    await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('无法读取思维导图 SVG，请重试或下载 SVG。'));image.src=url})
    const size=mindmapPNGSize(image.naturalWidth,image.naturalHeight)
    const canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height
    const context=canvas.getContext('2d')
    if(!context)throw new Error('浏览器无法创建导出画布，请下载 SVG。')
    context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height)
    context.drawImage(image,0,0,canvas.width,canvas.height)
    return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG 导出失败，请下载 SVG。')),'image/png'))
  } finally {URL.revokeObjectURL(url)}
}
