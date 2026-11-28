import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { PACE, STILL, animationLength, badgeText, createFrameClock, motionAt } from '../lib/pet-state.js'
import { createPetPainter } from '../lib/page/pet-painter.js'
import styles from './pet-selector.css'

const h = React.createElement
const compactQuery = '(max-width: 42rem)'
const mainActions = ['idle', 'think', 'work', 'attention', 'done', 'failed', 'sleep']
const licenses = {
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC-BY-SA-4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
}
const attribution = 'https://github.com/ECNU/EduWork/blob/main/packages/dsh-desktop-pet/skins/LICENSE'
export const skinName = (skin, t) => skin.name[t('locale')] ?? skin.name['zh-CN'] ?? skin.name.en

export function Thumbnail({ preview, size = 48 }) {
  if (!preview.crop) return h('img', { src: preview.src, alt: '', draggable: false, width: size, height: size, style: { objectFit: 'contain' } })
  const { x, y, width, height } = preview.crop
  const scale = size / Math.max(width, height)
  return h('span', { style: { position: 'relative', display: 'block', width: width * scale, height: height * scale, overflow: 'hidden' } },
    h('img', { src: preview.src, alt: '', draggable: false, style: { position: 'absolute', left: 0, top: 0, maxWidth: 'none', transformOrigin: '0 0',
      transform: `scale(${scale}) translate(${-x}px, ${-y}px)` } }))
}

function Artwork({ data, images, action, t }) {
  const stageRef = useRef(null), canvasRef = useRef(null), markRef = useRef(null), toggleRef = useRef(null)
  const { frame, badge, animation, pixelated } = data
  const animated = animation.frames.length > 1 || Boolean(animation.motion)
  const [playing, setPlaying] = useState(() => animated && !matchMedia('(prefers-reduced-motion: reduce)').matches)
  const mark = badgeText({ state: action, count: 1 })

  useLayoutEffect(() => {
    const stage = stageRef.current, canvas = canvasRef.current
    const painter = createPetPainter(canvas, canvas.getContext('2d'), images)
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    // Restart finite clips in the preview, retaining their frame and motion timing.
    const duration = animation.playback === 'blink' ? Infinity : animationLength(animation)
    let box, ratio, stageWidth, stageHeight
    let clock = createFrameClock(animation), timer, startedAt, elapsed = 0
    let frameIndex = 0, motion = STILL, active = animated && !reduced.matches

    const draw = () => {
      if (box) painter.draw(animation.frames[frameIndex], box, ratio, pixelated, false, motion)
    }
    const fit = () => {
      const { width, height } = stage.getBoundingClientRect()
      if (!width || !height || width === stageWidth && height === stageHeight && ratio === devicePixelRatio) return
      stageWidth = width
      stageHeight = height
      ratio = devicePixelRatio
      // Leave room for the shared player's motion and status marker.
      const margin = Math.min(24, width / 8, height / 8)
      const scale = Math.min((width - margin * 2) / frame.width, (height - margin * 2) / frame.height)
      const petWidth = frame.width * scale, petHeight = frame.height * scale
      box = { x: (width - petWidth) / 2, y: (height - petHeight) / 2, width: petWidth, height: petHeight }
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      if (markRef.current) {
        markRef.current.style.left = `${box.x + badge[0] * scale}px`
        markRef.current.style.top = `${box.y + badge[1] * scale}px`
      }
      painter.reset()
      draw()
      canvas.dataset.ready = 'true'
    }

    const stopTimer = () => {
      clearTimeout(timer)
      if (startedAt === undefined) return
      elapsed += performance.now() - startedAt
      startedAt = undefined
    }
    const setActive = value => {
      active = value
      setPlaying(value)
    }
    const tick = () => {
      const time = (elapsed + performance.now() - startedAt) % duration
      const step = clock(time)
      frameIndex = step.index
      motion = animation.motion ? motionAt(animation.motion, time) : STILL
      draw()
      const wait = Math.min(step.next, animation.motion ? PACE.motionFrame : Infinity)
      timer = setTimeout(tick, Math.max(16, wait))
    }
    const syncClock = () => {
      stopTimer()
      if (!active || document.hidden) return
      startedAt = performance.now()
      tick()
    }
    toggleRef.current = () => {
      if (!active && elapsed === 0) clock = createFrameClock(animation, { blinkImmediately: true })
      setActive(!active)
      syncClock()
    }
    const respectMotionPreference = () => {
      if (reduced.matches) setActive(false)
      syncClock()
    }
    const observer = new ResizeObserver(fit)
    observer.observe(stage)
    fit()
    syncClock()
    document.addEventListener('visibilitychange', syncClock)
    reduced.addEventListener('change', respectMotionPreference)
    window.addEventListener('resize', fit)
    return () => {
      stopTimer()
      observer.disconnect()
      document.removeEventListener('visibilitychange', syncClock)
      reduced.removeEventListener('change', respectMotionPreference)
      window.removeEventListener('resize', fit)
    }
  }, [data, images, animated])

  const playbackLabel = t(playing ? 'pause' : 'play')
  return h('div', { className: 'pet-stage', ref: stageRef },
    h('canvas', { ref: canvasRef, 'aria-hidden': true }),
    mark && h('span', { className: 'pet-state-mark', ref: markRef, 'aria-hidden': true }, mark),
    h('button', { type: 'button', className: 'pet-play-toggle', 'data-playing': playing, 'aria-label': playbackLabel,
      title: playbackLabel, disabled: !animated, onClick: () => toggleRef.current() }))
}

function ActionPreview({ skin, action, service, t }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setError(false)
    service.previewAction(skin.id, action).then(async value => {
      if (!active) return
      const images = await Promise.all(value.images.map(async ({ file, src }) => {
        const image = new Image()
        image.src = src
        await image.decode()
        return [file, image]
      }))
      if (active) setData({ data: value, images: new Map(images) })
    }).catch(() => {
      if (active) setError(true)
    })
    return () => { active = false }
  }, [service, skin.id, action, retry])
  if (data) return h(Artwork, { ...data, action, t })
  return h(React.Fragment, null,
    h('div', { className: 'pet-stage' }, h(Thumbnail, { preview: skin.preview, size: 120 })),
    h('div', { className: 'pet-preview-status' },
      error ? h(React.Fragment, null,
        h('span', { role: 'alert' }, t('actionError')),
        h('button', { type: 'button', onClick: () => setRetry(retry + 1) }, t('retry')))
        : h('span', { role: 'status' }, t('actionLoading'))))
}

export function PetSelector({ skins, current, service, locked, onClose, onSave, t }) {
  const dialog = useRef(null), title = useRef(null), previewTitle = useRef(null), list = useRef(null)
  const activeCard = useRef(null), didNavigate = useRef(false)
  const headingId = useId()
  const [compact, setCompact] = useState(() => matchMedia(compactQuery).matches)
  const [showPreview, setShowPreview] = useState(false)
  const [candidate, setCandidate] = useState(current)
  const [action, setAction] = useState(current.states.idle[0])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const canPreview = !compact || showPreview

  useLayoutEffect(() => {
    const element = dialog.current
    element.showModal()
    title.current.focus()
    return () => element.close()
  }, [])
  useEffect(() => {
    const query = matchMedia(compactQuery)
    const update = () => setCompact(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useLayoutEffect(() => {
    if (!compact || !didNavigate.current) return
    if (showPreview) previewTitle.current?.focus()
    else activeCard.current?.focus({ preventScroll: true })
  }, [compact, showPreview])

  const choose = skin => {
    activeCard.current = list.current.querySelector(`[data-skin-id="${skin.id}"]`)
    didNavigate.current = true
    setCandidate(skin)
    if (!skin.actions.includes(action)) setAction(skin.states.idle[0])
    setShowPreview(true)
    setSaveError(false)
  }
  const confirm = async () => {
    setSaving(true)
    setSaveError(false)
    setSaveError(!await onSave(candidate.id))
    setSaving(false)
  }
  const actionNames = new Map(t('actionNames').split('|').map(entry => entry.split('=')))
  const actionButton = name => h('button', { key: name, type: 'button', 'aria-pressed': action === name, onClick: () => setAction(name) },
    actionNames.get(name) ?? name)
  const primary = [...new Set([candidate.states.idle[0], ...candidate.states.working, ...mainActions])].filter(name => candidate.actions.includes(name))
  const extra = candidate.actions.filter(name => !primary.includes(name))
  const license = candidate.license === 'LicenseRef-ECNU-Mascot' ? t('ecnuRights') : candidate.license
  return h('dialog', { ref: dialog, className: 'eduwork-pet-picker', 'aria-labelledby': headingId, 'data-compact': compact,
    onCancel: event => { event.preventDefault(); if (!saving) onClose() } },
    h('style', null, styles),
    h('div', { className: 'pet-dialog-layout' },
      h('header', { className: 'pet-dialog-header' },
        h('h2', { ref: title, tabIndex: -1, id: headingId }, t('change')),
        h('button', { type: 'button', className: 'pet-close', 'aria-label': t('close'), disabled: saving, onClick: onClose }, '×')),
      h('div', { className: 'pet-dialog-body' },
        h('div', { ref: list, className: 'pet-skin-list', hidden: compact && showPreview, role: 'group', 'aria-label': t('skins') },
          skins.map(skin => h('button', { type: 'button', key: skin.id, 'data-skin-id': skin.id, disabled: saving,
            'aria-pressed': canPreview && skin.id === candidate.id, onClick: () => choose(skin) },
            h('span', { className: 'pet-thumbnail' }, h(Thumbnail, { preview: skin.preview, size: 46 })),
            h('span', null, h('strong', null, skinName(skin, t)), skin.id === current.id && h('small', null, t('current')))))),
        canPreview && h('section', { className: 'pet-detail', 'aria-label': t('preview') },
          compact && h('button', { type: 'button', className: 'pet-back', disabled: saving, onClick: () => setShowPreview(false) }, t('back')),
          h('div', { className: 'pet-detail-heading' },
            h('div', { className: 'pet-preview-label', 'aria-live': 'polite' }, t('preview'), candidate.id === current.id && ` · ${t('current')}`),
            h('h3', { ref: previewTitle, tabIndex: -1 }, skinName(candidate, t)),
            h('div', { className: 'pet-attribution' },
              candidate.author && h('span', null, t('author').replace('{author}', candidate.author)),
              license && h('a', { href: licenses[candidate.license] ?? attribution, target: '_blank', rel: 'noreferrer' }, license),
              h('a', { href: attribution, target: '_blank', rel: 'noreferrer' }, t('credits')))),
          h(ActionPreview, { key: `${candidate.id}/${action}`, skin: candidate, action, service, t }),
          h('div', { className: 'pet-actions', role: 'group', 'aria-label': t('actions') }, primary.map(actionButton)),
          extra.length > 0 && h('details', { open: extra.includes(action) || undefined },
            h('summary', null, t('more')), h('div', { className: 'pet-actions', role: 'group', 'aria-label': t('more') }, extra.map(actionButton)))),
      ),
      h('footer', { className: 'pet-dialog-footer' },
        saveError && h('p', { role: 'alert' }, t('saveFailed')),
        h('button', { type: 'button', disabled: saving, onClick: onClose }, t('cancel')),
        canPreview && h('button', { type: 'button', className: 'pet-confirm', onClick: confirm,
          disabled: locked || saving || candidate.id === current.id }, t(saving ? 'saving' : 'use')))))
}
