import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatFileMention } from '@deepseek-ai/dsh-file-reference/grammar'
import { IconPaperclipOutline16, IconPlusOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { isComposerPasteEvent } from './paste-target.js'

const h = React.createElement
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const MAX_FILES = 20
const MAX_FILE_BYTES = 64 * 1024 * 1024
const MAX_TOTAL_BYTES = 128 * 1024 * 1024
const MAX_BROWSER_FALLBACK_BYTES = 4 * 1024 * 1024
const NATIVE_GRANT_CALLBACK = '__chatecnuNativeFileGrant'
const NATIVE_REQUEST_MARKER_X = -314159
let nativeCorrelation = 0

export function workspaceFileReference(path) {
  const mention = formatFileMention({ kind: 'file', path }, false)
  if (mention === undefined) throw new Error('导入后的文件路径无法表示为 @file 引用')
  const label = path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1)
  if (label === undefined) throw new Error('导入后的文件名无效')
  return {
    source: 'reference', ref: mention, label, appearance: 'file', clipboardText: mention,
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error(`无法读取文件“${file.name || 'file'}”`))
    reader.onabort = () => reject(new Error(`文件读取已取消：“${file.name || 'file'}”`))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`无法读取文件“${file.name || 'file'}”`))
        return
      }
      const comma = reader.result.indexOf(',')
      if (comma < 0) {
        reject(new Error(`文件编码失败：“${file.name || 'file'}”`))
        return
      }
      resolve(reader.result.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}

async function uploadPayload(file) {
  return {
    name: file.name || 'file', mediaType: file.type || 'application/octet-stream',
    bytes: file.size, data: await fileToBase64(file),
  }
}

function validateDocuments(files) {
  if (files.length > MAX_FILES) throw new Error(`一次最多添加 ${MAX_FILES} 个文件`)
  if (files.some(file => file.size > MAX_FILE_BYTES)) throw new Error('单个文件不能超过 64 MiB')
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) throw new Error('一次添加的文件总大小不能超过 128 MiB')
}

function validateBrowserFallback(files) {
  if (files.some(file => file.size > MAX_BROWSER_FALLBACK_BYTES)) {
    throw new Error('当前浏览器环境无法安全导入超过 4 MiB 的文件；请使用 ChatECNU Work 桌面版')
  }
}

function nativeFileBridge() {
  const webview = window.chrome?.webview
  if (typeof webview?.postMessageWithAdditionalObjects !== 'function') return null
  return {
    resolveFilePaths(marker, correlation, files) {
      webview.postMessageWithAdditionalObjects(`file:drop:${marker}:${correlation}`, files)
    },
  }
}

function FileDropOverlay({ busy }) {
  return createPortal(h('div', {
    role: 'status', 'data-chatecnu-file-drop': '',
    style: {
      position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center', pointerEvents: 'none',
      background: 'color-mix(in srgb, var(--dsw-alias-bg-mask-1, rgba(0,0,0,.32)) 82%, transparent)',
      backdropFilter: 'blur(5px)',
    },
  }, h('div', {
    style: {
      minWidth: 280, padding: '25px 30px', border: '1px dashed var(--dsw-alias-border-l2)', borderRadius: 16,
      background: 'var(--dsw-alias-bg-module-platform, #fff)', color: 'var(--dsw-alias-label-primary)', textAlign: 'center',
      boxShadow: '0 18px 50px rgba(0,0,0,.16)',
    },
  }, h('div', { 'aria-hidden': true, style: { fontSize: 32, marginBottom: 8 } }, '⇩'),
  h('strong', { style: { display: 'block', fontSize: 15 } }, busy ? '当前正在处理文件' : '松开即可添加到对话'),
  h('span', { style: { display: 'block', marginTop: 6, color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } },
    '图片使用 DSH 原生附件，其他文件复制到当前工作区'))), document.body)
}

function AddMenu({ anchor, onFiles, onCommands, close }) {
  const menuRef = useRef(null)
  const rect = anchor.current?.getBoundingClientRect()
  useEffect(() => {
    const onPointerDown = event => {
      if (!(event.target instanceof Node) || menuRef.current?.contains(event.target) || anchor.current?.contains(event.target)) return
      close()
    }
    const onKeyDown = event => { if (event.key === 'Escape') close() }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [anchor, close])
  if (rect === undefined) return null
  const row = {
    display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr)', alignItems: 'center', gap: 8,
    width: '100%', minHeight: 38, padding: '7px 10px', border: 0, borderRadius: 8,
    background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', textAlign: 'left',
  }
  return createPortal(h('div', {
    ref: menuRef, role: 'menu', 'aria-label': '添加到对话', 'data-chatecnu-add-menu': '',
    style: {
      position: 'fixed', zIndex: 10020, left: Math.max(8, rect.left), bottom: window.innerHeight - rect.top + 8,
      width: 230, padding: 6, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12,
      background: 'var(--dsw-alias-bg-module-platform, #fff)', boxShadow: '0 14px 40px rgba(0,0,0,.16)',
    },
  },
  h('button', { type: 'button', role: 'menuitem', style: row, onMouseDown: event => event.preventDefault(), onClick: onFiles },
    h('span', { 'aria-hidden': true, style: { display: 'grid', placeItems: 'center' } }, h(IconPaperclipOutline16, { size: 16 })),
    h('span', null, h('strong', { style: { display: 'block', fontSize: 13 } }, '文件和图片'),
      h('small', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11 } }, '添加到当前对话和工作区'))),
  h('button', { type: 'button', role: 'menuitem', style: row, onMouseDown: event => event.preventDefault(), onClick: onCommands },
    h('span', { 'aria-hidden': true, style: { fontSize: 16 } }, '⌘'),
    h('span', null, h('strong', { style: { display: 'block', fontSize: 13 } }, '命令与工作流'),
      h('small', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11 } }, '打开 DSH 原生命令菜单')))), document.body)
}

export function WorkspaceFileInput({ sessionId, input, inputActions, locked, onAddImages, openCommands, commandMenuOpen, insertReference, importFiles, importNativeFiles, notify }) {
  const pickerRef = useRef(null)
  const buttonRef = useRef(null)
  const latestRef = useRef({ sessionId, input, inputActions, onAddImages, insertReference, importFiles, importNativeFiles, notify })
  const nativePendingRef = useRef(new Map())
  const nativeCallbackRef = useRef(null)
  const runningRef = useRef(false)
  const [running, setRunning] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  latestRef.current = { sessionId, input, inputActions, onAddImages, insertReference, importFiles, importNativeFiles, notify }
  useEffect(() => { if (commandMenuOpen) setMenuOpen(false) }, [commandMenuOpen])

  const ensureNativeListener = () => {
    if (nativeCallbackRef.current !== null) return true
    if (nativeFileBridge() === null) return false
    const callback = receipt => {
      const correlation = Number(receipt?.correlation)
      const pending = nativePendingRef.current.get(correlation)
      if (pending === undefined) return
      nativePendingRef.current.delete(correlation)
      clearTimeout(pending.timeout)
      if (typeof receipt?.error === 'string' && receipt.error !== '') {
        pending.reject(new Error(receipt.error))
        return
      }
      if (typeof receipt?.grant !== 'string' || !/^[a-f0-9]{32}$/u.test(receipt.grant)) {
        pending.reject(new Error('桌面文件授权无效'))
        return
      }
      pending.resolve(receipt)
    }
    window[NATIVE_GRANT_CALLBACK] = callback
    nativeCallbackRef.current = callback
    return true
  }

  useEffect(() => {
    ensureNativeListener()
    return () => {
      if (window[NATIVE_GRANT_CALLBACK] === nativeCallbackRef.current) delete window[NATIVE_GRANT_CALLBACK]
      nativeCallbackRef.current = null
      for (const pending of nativePendingRef.current.values()) {
        clearTimeout(pending.timeout)
        pending.reject(new Error('文件导入已取消'))
      }
      nativePendingRef.current.clear()
    }
  }, [])

  const resolveNativeGrant = files => {
    const bridge = nativeFileBridge()
    if (bridge === null || !ensureNativeListener()) return null
    nativeCorrelation = nativeCorrelation >= 2_000_000_000 ? 1 : nativeCorrelation + 1
    const correlation = nativeCorrelation
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        nativePendingRef.current.delete(correlation)
        reject(new Error('桌面文件复制超时'))
      }, 120_000)
      nativePendingRef.current.set(correlation, { resolve, reject, timeout })
      try {
        bridge.resolveFilePaths(NATIVE_REQUEST_MARKER_X, correlation, files)
      } catch (error) {
        clearTimeout(timeout)
        nativePendingRef.current.delete(correlation)
        reject(error)
      }
    })
  }

  const accept = async fileList => {
    const files = Array.from(fileList ?? [])
    if (files.length === 0 || runningRef.current) return
    const current = latestRef.current
    if (current.input?.phase !== 'plain' || current.inputActions === undefined) {
      current.notify('请等待当前消息提交完成后再添加文件')
      return
    }
    runningRef.current = true
    setRunning(true)
    try {
      const images = files.filter(file => IMAGE_TYPES.has(file.type))
      const documents = files.filter(file => !IMAGE_TYPES.has(file.type))
      validateDocuments(documents)
      if (documents.length > 0) {
        const nativeGrant = typeof current.importNativeFiles === 'function' ? resolveNativeGrant(documents) : null
        let result
        if (nativeGrant !== null) {
          const receipt = await nativeGrant
          if (!Array.isArray(receipt.files) || receipt.files.length !== documents.length) throw new Error('桌面文件复制结果不完整')
          result = await current.importNativeFiles(current.sessionId, receipt.grant)
        } else {
          validateBrowserFallback(documents)
          const payloads = []
          for (const file of documents) payloads.push(await uploadPayload(file))
          result = await current.importFiles(current.sessionId, payloads)
        }
        const latest = latestRef.current
        if (latest.input?.phase !== 'plain' || latest.inputActions === undefined) {
          throw new Error('文件已复制到工作区，但当前输入状态已变化；请使用 @file 重新选择')
        }
        if (typeof latest.insertReference !== 'function') {
          throw new Error('文件已复制到工作区，但当前输入组件不支持文件卡片；请使用 @file 重新选择')
        }
        for (const file of result.files) {
          if (latest.insertReference(workspaceFileReference(file.path)) !== true) {
            throw new Error('文件已复制到工作区，但文件卡片未能加入当前输入；请使用 @file 重新选择')
          }
        }
      }
      if (images.length > 0) {
        if (typeof current.onAddImages !== 'function') throw new Error('DSH 图片附件入口暂时不可用')
        current.onAddImages(images)
      }
    } catch (error) {
      current.notify(error instanceof Error ? error.message : String(error))
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }

  useEffect(() => {
    let depth = 0
    const fileTransfer = event => event.dataTransfer?.types?.includes('Files') === true ? event.dataTransfer : null
    const stop = event => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const reset = () => {
      depth = 0
      setDragActive(false)
    }
    const onDragEnter = event => {
      if (fileTransfer(event) === null) return
      stop(event)
      depth += 1
      setDragActive(true)
    }
    const onDragOver = event => {
      const transfer = fileTransfer(event)
      if (transfer === null) return
      stop(event)
      transfer.dropEffect = runningRef.current ? 'none' : 'copy'
    }
    const onDragLeave = event => {
      if (fileTransfer(event) === null) return
      stop(event)
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragActive(false)
      const outside = event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight
      if (outside) reset()
    }
    const onDrop = event => {
      const transfer = fileTransfer(event)
      if (transfer === null) return
      reset()
      const files = Array.from(transfer.files)
      if (files.length > 0 && files.every(file => IMAGE_TYPES.has(file.type))) return
      stop(event)
      void accept(transfer.files)
    }
    const onPaste = event => {
      if (!isComposerPasteEvent(event)) return
      const itemFiles = Array.from(event.clipboardData?.items ?? [])
        .filter(item => item.kind === 'file')
        .map(item => item.getAsFile())
        .filter(file => file !== null)
      const files = itemFiles.length > 0 ? itemFiles : Array.from(event.clipboardData?.files ?? [])
      if (files.length === 0 || files.every(file => IMAGE_TYPES.has(file.type))) return
      event.preventDefault()
      event.stopImmediatePropagation()
      void accept(files)
    }
    document.addEventListener('dragenter', onDragEnter, true)
    document.addEventListener('dragover', onDragOver, true)
    document.addEventListener('dragleave', onDragLeave, true)
    document.addEventListener('drop', onDrop, true)
    document.addEventListener('paste', onPaste, true)
    window.addEventListener('dragend', reset)
    return () => {
      document.removeEventListener('dragenter', onDragEnter, true)
      document.removeEventListener('dragover', onDragOver, true)
      document.removeEventListener('dragleave', onDragLeave, true)
      document.removeEventListener('drop', onDrop, true)
      document.removeEventListener('paste', onPaste, true)
      window.removeEventListener('dragend', reset)
    }
  }, [])

  return h(React.Fragment, null,
    h('input', {
      ref: pickerRef, type: 'file', multiple: true, tabIndex: -1, 'aria-hidden': true,
      'data-chatecnu-workspace-file-picker': '',
      style: { display: 'none' },
      onChange: event => {
        void accept(event.currentTarget.files)
        event.currentTarget.value = ''
      },
    }),
    h('button', {
      ref: buttonRef, type: 'button', title: '添加', 'aria-label': '添加', 'aria-haspopup': 'menu',
      'aria-expanded': menuOpen || commandMenuOpen, disabled: running || locked || input?.phase !== 'plain',
      onMouseDown: event => { event.preventDefault() },
      onClick: () => { setMenuOpen(value => !value) },
      style: {
        display: 'inline-grid', placeItems: 'center', width: 28, height: 28, padding: 0, border: 0, borderRadius: 8,
        background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: running ? 'wait' : 'pointer', fontSize: 16,
      },
    }, running ? '…' : h(IconPlusOutline16, { size: 14 })),
    menuOpen ? h(AddMenu, {
      anchor: buttonRef, close: () => setMenuOpen(false),
      onFiles: () => { setMenuOpen(false); pickerRef.current?.click() },
      onCommands: () => { setMenuOpen(false); openCommands?.() },
    }) : null,
    dragActive ? h(FileDropOverlay, { busy: running }) : null)
}
