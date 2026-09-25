// Presentation-only adaptation of the pinned rc.2 conversation derivative.
// Keep Lexical identity, clipboard text, references, permissions and send paths.
// Each anchor must be unique; a changed upstream bundle must be reviewed.
import { Script } from 'node:vm'

export function adaptNativeFileReferenceUI(source) {
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error(`Native file reference anchor changed: ${before.slice(0, 100)}`)
    source = source.replace(before, after)
  }
  replace('function ReferenceChip({ label, appearance, invalid }) {', `${fileCardRuntime.toString()}
    const EduWorkReferenceCard = fileCardRuntime(react, _deepseek_ai_dsh_client_ui_primitives);
    function ReferenceChip({ label, appearance, invalid, fileBytes, editor, remove }) {
      if (appearance === "file") return react.createElement(EduWorkReferenceCard, { label, invalid, fileBytes, editor, remove });`)
  // The metadata is optional and display-only. No filesystem read is introduced.
  replace('appearance: directory ? "folder" : "file",', 'appearance: directory ? "folder" : "file",\nfileBytes: directory ? void 0 : file.size,')
  replace('clipboardText: node.__clipboardText', 'fileBytes: node.__fileBytes,\nclipboardText: node.__clipboardText')
  replace('clipboardText: json.clipboardText', 'fileBytes: json.fileBytes,\nclipboardText: json.clipboardText')
  replace('this.__clipboardText = insert.clipboardText;', 'this.__clipboardText = insert.clipboardText;\nthis.__fileBytes = Number.isSafeInteger(insert.fileBytes) && insert.fileBytes >= 0 ? insert.fileBytes : void 0;')
  replace('clipboardText: this.__clipboardText,', 'fileBytes: this.__fileBytes,\nclipboardText: this.__clipboardText,')
  replace('clipboardText: chip.getTextContent(),', 'fileBytes: chip.getLatest().__fileBytes,\nclipboardText: chip.getTextContent(),')
  replace('clipboardText: occurrence.clipboardText', 'fileBytes: occurrence.fileBytes,\nclipboardText: occurrence.clipboardText')
  // An asynchronous reference-decoration rescan dirties multiple text nodes.
  // It must not insert a no-op history entry after the actual file removal.
  const rescan = 'function rescanTextRefs(editor) {\n\t\t\teditor.update(() => {\n\t\t\t\tfor (const node of nl().getAllTextNodes()) node.markDirty();\n\t\t\t});\n\t\t}'
  replace(rescan, rescan.replace('\n\t\t\t});', '\n\t\t\t}, { tag: "history-merge" });'))
  replace('decorate() {\n\t\t\t\treturn (0, react_jsx_runtime.jsx)(ReferenceChip, {', `decorate(editor) {
        return (0, react_jsx_runtime.jsx)(ReferenceChip, {
          editor,
          fileBytes: this.__fileBytes,
          remove: () => {
            if (!editor.isEditable()) return;
            // Focus first: focusing after removal creates a second history
            // entry in this upstream editor and consumes the first undo.
            editor.focus(() => {
              if (!editor.isEditable()) return;
              editor.update(() => { if (this.isAttached()) this.remove(); }, { discrete: true, tag: "history-push" });
            });
          },`)
  new Script(source, { filename: 'ui-conversation-file-reference-candidate.js' })
  return source
}

// Self-contained so tests can render the exact UI installed into the derivative.
export function fileCardRuntime(React, primitives) {
  const css = `.eduwork-input-file{display:inline-flex;align-items:center;vertical-align:middle;gap:9px;box-sizing:border-box;max-width:100%;width:270px;padding:9px 8px 9px 11px;margin:3px 4px 3px 0;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);line-height:1.45;user-select:none}
.eduwork-input-file__body{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.eduwork-input-file__name{font-size:13px;font-weight:500;overflow-wrap:anywhere;white-space:normal}
.eduwork-input-file__meta{font-size:12px;color:var(--dsw-alias-label-secondary)}
.eduwork-input-file__remove{flex:none;align-self:flex-start;display:grid;place-items:center;min-width:24px;min-height:24px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.eduwork-input-file__remove:hover{background:var(--dsw-alias-bg-module-platform)}
.eduwork-input-file__remove:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.eduwork-input-file__remove:disabled{opacity:.4;cursor:default}
.eduwork-input-file[data-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}
.eduwork-input-file[data-invalid=true] .eduwork-input-file__meta{color:var(--dsw-alias-state-error-primary)}
@media(max-width:480px){.eduwork-input-file{width:100%;margin-right:0}}`
  const tag = document.createElement('style')
  tag.dataset.eduworkFileCards = ''
  tag.textContent = css
  document.head.append(tag)
  return function FileReferenceCard({ label, invalid, fileBytes, editor, remove }) {
    const [editable, setEditable] = React.useState(() => editor.isEditable())
    React.useEffect(() => editor.registerEditableListener(setEditable), [editor])
    const zh = document.documentElement.lang.toLowerCase().startsWith('zh')
    const extension = primitives.fileExtension(label).toUpperCase().slice(0, 8)
    const meta = [extension, Number.isSafeInteger(fileBytes) && fileBytes >= 0 ? primitives.fileSizeText(fileBytes) : '',
      invalid ? (zh ? '文件引用失效' : 'Invalid file reference') : ''].filter(Boolean).join(' · ')
    const h = React.createElement
    return h('span', { className: 'eduwork-input-file', 'data-eduwork-file-card': '', 'data-invalid': invalid, title: label },
      h('span', { 'aria-hidden': true }, h(primitives.FileTypeIcon, { path: label, size: 30 })),
      h('span', { className: 'eduwork-input-file__body' },
        h('span', { className: 'eduwork-input-file__name' }, label),
        h('span', { className: 'eduwork-input-file__meta' }, meta)),
      h('button', { type: 'button', className: 'eduwork-input-file__remove', disabled: !editable,
        'aria-label': (zh ? '移除文件：' : 'Remove file: ') + label,
        onMouseDownCapture: event => { event.preventDefault(); event.stopPropagation() },
        onClickCapture: event => { event.preventDefault(); event.stopPropagation(); remove() },
        onKeyDownCapture: event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation() },
      }, h(primitives.IconCloseFillRegular, { size: 14 })))
  }
}
