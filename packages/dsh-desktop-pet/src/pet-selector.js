import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { PACE, STILL, badgeText, createFrameClock, motionAt } from '../lib/pet-state.js'
import { createPetPainter } from '../lib/page/pet-painter.js'
import styles from './pet-selector.css'

const h = React.createElement
const compactQuery = '(max-width: 42rem)'
const stage = { width: 248, height: 218 }
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

function Artwork({ data, images, action, replay, paused }) {
  const ref = useRef(null)
  const { frame, badge, animation, pixelated } = data
  const scale = Math.min((stage.width - 48) / frame.width, (stage.height - 44) / frame.height)
  const width = frame.width * scale, height = frame.height * scale
  const box = { width, height, x: (stage.width - width) / 2, y: (stage.height - height) / 2 }
  const mark = badgeText({ state: action, count: 1 })
  useEffect(() => {
    const canvas = ref.current
    const painter = createPetPainter(canvas, canvas.getContext('2d'), images)
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    let timer, start, clock
    const tick = () => {
      const elapsed = performance.now() - start
      const moving = !paused && !document.hidden && (!reduced.matches || replay > 0 && elapsed < 8000)
      const step = moving ? clock(elapsed) : { index: 0, next: Infinity }
      const animateMotion = moving && animation.motion && (!reduced.matches || elapsed < 3000)
      const motion = animateMotion ? motionAt(animation.motion, elapsed) : STILL
      painter.draw(animation.frames[step.index], box, devicePixelRatio, pixelated, false, motion)
      const wait = Math.min(step.next, animateMotion ? PACE.motionFrame : Infinity)
      const remaining = reduced.matches && moving ? 8000 - elapsed : Infinity
      const next = Math.min(wait, remaining)
      if (Number.isFinite(next)) timer = setTimeout(tick, Math.max(16, next))
    }
    const restart = () => {
      clearTimeout(timer)
      canvas.width = Math.round(stage.width * devicePixelRatio)
      canvas.height = Math.round(stage.height * devicePixelRatio)
      painter.reset()
      start = performance.now()
      clock = createFrameClock(animation, { blinkImmediately: replay > 0 })
      tick()
    }
    restart()
    canvas.dataset.ready = 'true'
    document.addEventListener('visibilitychange', restart)
    reduced.addEventListener('change', restart)
    window.addEventListener('resize', restart)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', restart)
      reduced.removeEventListener('change', restart)
      window.removeEventListener('resize', restart)
    }
  }, [data, images, replay, paused])
  return h('div', { className: 'pet-artwork', 'aria-hidden': true },
    h('canvas', { ref }),
    mark && h('span', { className: 'pet-state-mark', style: {
      left: `${(box.x + badge[0] * scale) / stage.width * 100}%`,
      top: `${(box.y + badge[1] * scale) / stage.height * 100}%`,
    } }, mark))
}

function ActionPreview({ skin, action, service, t }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [replay, setReplay] = useState(0)
  const [paused, setPaused] = useState(false)
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
  return h(React.Fragment, null,
    h('div', { className: 'pet-stage' },
      h('div', { className: 'pet-stage-fallback' }, h(Thumbnail, { preview: skin.preview, size: 120 })),
      data && h(Artwork, { ...data, action, replay, paused })),
    h('div', { className: 'pet-playback' },
      !data && !error && h('span', { role: 'status' }, t('actionLoading')),
      error && h('span', { role: 'alert' }, t('actionError')),
      error && h('button', { type: 'button', onClick: () => setRetry(retry + 1) }, t('retry')),
      data && h('button', { type: 'button', onClick: () => { setPaused(false); setReplay(replay + 1) } }, t('replay')),
      data && h('button', { type: 'button', 'aria-pressed': paused, onClick: () => setPaused(!paused) }, t('still'))))
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
    if (await onSave(candidate.id)) onClose()
    else { setSaveError(true); setSaving(false) }
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
            h('div', { className: 'pet-preview-label' }, t('preview'), candidate.id === current.id && ` · ${t('current')}`),
            h('h3', { ref: previewTitle, tabIndex: -1 }, skinName(candidate, t)),
            h('div', { className: 'pet-attribution' },
              candidate.author && h('span', null, t('author').replace('{author}', candidate.author)),
              license && h('a', { href: licenses[candidate.license] ?? attribution, target: '_blank', rel: 'noreferrer' }, license),
              h('a', { href: attribution, target: '_blank', rel: 'noreferrer' }, t('credits')))),
          h(ActionPreview, { key: `${candidate.id}/${action}`, skin: candidate, action, service, t }),
          h('div', { className: 'pet-actions', role: 'group', 'aria-label': t('actions') }, primary.map(actionButton)),
          extra.length > 0 && h('details', { open: extra.includes(action) || undefined },
            h('summary', null, t('more')), h('div', { className: 'pet-actions' }, extra.map(actionButton)))),
      ),
      h('footer', { className: 'pet-dialog-footer' },
        saveError && h('p', { role: 'alert' }, t('saveFailed')),
        h('button', { type: 'button', disabled: saving, onClick: onClose }, t('cancel')),
        canPreview && h('button', { type: 'button', className: 'pet-confirm', onClick: confirm,
          disabled: locked || saving || candidate.id === current.id }, t(saving ? 'saving' : 'use')))))
}
