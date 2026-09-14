// Portable media contract. No DSH, provider, filesystem or renderer dependencies.
// Canonical source; applications and video tools import this module.
export function voiceTiming(durationSeconds, fps, leadInSeconds = .18, tailSeconds = .45) {
  if (![durationSeconds, fps, leadInSeconds, tailSeconds].every(Number.isFinite) || durationSeconds <= 0 || !Number.isInteger(fps) || fps < 1 || leadInSeconds < 0 || tailSeconds < 0) throw new Error('Invalid voice timing')
  const fromFrame = Math.round(leadInSeconds * fps)
  const audioFrames = Math.ceil(durationSeconds * fps)
  return { fromFrame, audioFrames, durationInFrames: fromFrame + audioFrames + Math.max(1, Math.ceil(tailSeconds * fps)) }
}

export function buildTimeline(segments, {fps = 30, leadInSeconds = .18, tailSeconds = .45} = {}) {
  let cursor = 0
  return segments.map(segment => {
    const timing = segment.silent ? {fromFrame:0,audioFrames:0,durationInFrames:Math.ceil(segment.duration*fps)} : voiceTiming(segment.duration, fps, leadInSeconds, tailSeconds)
    if(!Number.isSafeInteger(timing.durationInFrames)||timing.durationInFrames<1)throw new Error('Invalid scene duration')
    const item = {...segment, ...timing, startFrame: cursor, endFrame: cursor + timing.durationInFrames}
    cursor = item.endFrame
    return item
  })
}

function timestamp(milliseconds, separator) {
  const ms = Math.max(0, Math.round(milliseconds))
  return `${String(Math.floor(ms / 3600000)).padStart(2,'0')}:${String(Math.floor(ms / 60000) % 60).padStart(2,'0')}:${String(Math.floor(ms / 1000) % 60).padStart(2,'0')}${separator}${String(ms % 1000).padStart(3,'0')}`
}

// Segment-level captions: text and audio come from the exact same synthesis job.
// Do not invent word timestamps by dividing a sentence into equal intervals.
export function subtitleText(timeline, fps, format = 'srt') {
  const separator = format === 'vtt' ? '.' : ','
  return (format === 'vtt' ? 'WEBVTT\n\n' : '') + timeline.map((item,index) => {
    const start = (item.startFrame + item.fromFrame) * 1000 / fps
    const end = start + item.audioFrames * 1000 / fps
    const text = String(item.text).replace(/\r?\n/g,' ').replace(/-->/g,'→').replace(/[<>]/g,'')
    return `${index+1}\n${timestamp(start,separator)} --> ${timestamp(end,separator)}\n${text}\n`
  }).join('\n')
}

export function splitNarration(text, limit = 42) {
  const parts = String(text).trim().match(/[^。！？!?；;\n]+[。！？!?；;]?/gu) || []
  return parts.flatMap(part => {
    const chars = Array.from(part.trim()), result = []
    for (let i=0; i<chars.length; i+=limit) result.push(chars.slice(i,i+limit).join(''))
    return result
  }).filter(Boolean)
}
