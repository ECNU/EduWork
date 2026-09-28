import { describe, expect, it } from 'vitest'
import { gzipSync } from 'node:zlib'
import { extractPdfText, extractSource, htmlToMarkdown, isSafeArchivePath, minifyLandingPageHtml, pdfItemText, stripTex, untarSource } from '@eduwork/dsh-literature/core'
import { LiteratureError } from '@eduwork/dsh-literature/core'

/** A gzipped tarball holding `src/main.tex` and `src/refs.bib`. */
const TARBALL_B64 = 'H4sIAAAAAAAAA+2TTUvEMBBAc+6vmLvSnfQjPQl60/see2nT0S2bJpJksVL636VgIbCKwlIUzbvMkMBkMsNzVu7YxiBiVZXAEHlVYhhXgPEyy6tCFJhzhjwTPAdWbt3Ywsn5xjJE5Q4X1Vk/ssZfQDjTMA9xVu6Gptepp3GrPhBRiOLT/XNxtv8iKwUw3KqhkH++/7oz8jSQ9lI1zk2N9b1UNCd1S0+9ntbbOQEc8fkKQZphOUjuSSkDL8aqLoXakfS90dOD9tbMsKfRw4EspUlNugvK/NgwIh+y+G/p0aVt3271xhf+Y16d+59j9P9SvuP/7bvx05Fer8H3XtHNdAf7JZmjrpFIJPJneQMsZmBUAA4AAA=='
const PDF_B64 = 'JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNjEyIDc5Ml0vQ29udGVudHMgNCAwIFIvUmVzb3VyY2VzPDwvRm9udDw8L0YxIDUgMCBSPj4+Pj4+ZW5kb2JqCjQgMCBvYmo8PC9MZW5ndGggNDQ+PnN0cmVhbQpCVCAvRjEgMjQgVGYgMTAwIDcwMCBUZCAoSGVsbG8gUERGKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmo8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2E+PmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNTQgMDAwMDAgbiAKMDAwMDAwMDM0NiAwMDAwMCBuIAp0cmFpbGVyPDwvU2l6ZSA2L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKNDA2CiUlRU9GCg=='
const TARBALL2_B64 = 'H4sIAAAAAAAAA+2WwWqEMBCGc96nyBO4k2gi9NhbD32DXlJN2aWJWZIsVcR3Lx4EqS0KErbgfJd4ckaHL/8EX51JYgCgLAUlAKwUMD8nKGGC56UAKCUnwLjkjBKRurGRe4jKEwATLrveM33IdP4D5v90/jwn+Or8qj71x9XoVH0AgJTF3/Nn+c/5F1zklECqhuYcfP7KmCf6fr+a+vSwPpHHMfpvVeVdyELs0tRY85/zhf+yAPR/L1v8f2v0V+WsVU3dt0PfDXgNHIrR/8ZFHTJbp6qxmv9smf8S8383W/y/aGMctZj+B2X0/6Zu2mdRt4lqrPmfL/f/opDo/1425X/QVby6pn9ponfD6dnVHY26jRneCEdg9N9rVVudxTamqbGa/7/s/wz3/91sz//YRtQdQRDkUHwDQYqr6wAaAAA='
const TARBALL3_B64 = 'H4sIAAAAAAAAA+3SQQrDIBAF0Fn3FJ6g+UbHOU9JFl0kLWi76O2LC2GgZFUkgczbjAuRr9+Sp4E6AyDCjgAvDD0bR57HIFw3CsGPKQZH3DtY9S6vWyZgKfe/zmkXafMA9JvqtVbyNDwfy+e6zt1yAEgpbvfvf/qPPtT/0i2RcvL+a/dunS+7hTTGGLOLL2+joVsACgAA'
const TARBALL4_B64 = 'H4sIAAAAAAAAA+3U0QrCIBQGYK97ivME7Xd69HnWGjlYDdRBvX3sYiEREQxZlN+NXsmvh9/g20pkBsBaJgFIy0jXBQnJtbIMKVkLyNqASXDuYLMpxMYLYAhu1TnLRZb1C6Rvmu5TwbdVs4/dNWMOAMboN/M3z/NXrBUJZMz08O/zd6OPu80iFhub+3/YuP9Kvei/Lv1f65P+R9cH6gM1dJ5aR8N4OXWeDuPxVj6FoiiKX3YHd5FPNAAOAAA='

function bytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

/** Build one POSIX ustar entry (regular file) for in-memory tarball fixtures. */
function tarEntry(name: string, content: string): Buffer {
  const header = Buffer.alloc(512)
  Buffer.from(name).copy(header, 0, 0, 100)
  header.write(content.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii')
  header[156] = 0x30 // '0': regular file
  header.fill(0x20, 148, 156) // the checksum field counts as spaces
  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii')
  const data = Buffer.alloc(Math.ceil(content.length / 512) * 512)
  Buffer.from(content).copy(data)
  return Buffer.concat([header, data])
}

/** A gzipped tarball holding the given entries. */
function tarballOf(entries: Array<[string, string]>): Uint8Array {
  return new Uint8Array(gzipSync(Buffer.concat(entries.map(([name, content]) => tarEntry(name, content)))))
}

describe('stripTex', () => {
  it('strips comments, environments, and commands to prose', () => {
    const tex = '\\begin{document}\n% comment\nHello \\textbf{world}. \\section{Intro}\n\\end{document}'
    expect(stripTex(tex)).toBe('Hello world. Intro')
  })
})

describe('untarSource', () => {
  it('decompresses and returns only text files by path', async () => {
    const files = await untarSource(bytes(TARBALL_B64))
    expect(files.has('src/main.tex')).toBe(true)
    expect(files.has('src/refs.bib')).toBe(true)
    expect(files.get('src/refs.bib')).toContain('@article')
  })
  it('rejects non-gzip input', () => {
    expect(() => untarSource(new Uint8Array([1, 2, 3]))).toThrow(LiteratureError)
  })
  it('skips entries with parent-directory or absolute paths', async () => {
    const files = await untarSource(tarballOf([
      ['../evil.txt', 'nope'],
      ['/etc/passwd', 'nope'],
      ['main.tex', 'hello'],
    ]))
    expect(files.has('../evil.txt')).toBe(false)
    expect(files.has('/etc/passwd')).toBe(false)
    expect(files.get('main.tex')).toBe('hello')
  })
})

describe('isSafeArchivePath', () => {
  it('rejects traversal and absolute paths, accepting ordinary relative ones', () => {
    expect(isSafeArchivePath('src/main.tex')).toBe(true)
    expect(isSafeArchivePath('a/b/c.tex')).toBe(true)
    expect(isSafeArchivePath('../evil.tex')).toBe(false)
    expect(isSafeArchivePath('a/../evil.tex')).toBe(false)
    expect(isSafeArchivePath('/etc/passwd')).toBe(false)
    expect(isSafeArchivePath('C:\\evil.tex')).toBe(false)
  })
})

describe('extractSource', () => {
  it('extracts text files plus a readable summary from the main tex', async () => {
    const { files, summary } = await extractSource(bytes(TARBALL_B64), { maxFileChars: 1000, maxSummaryChars: 1000 })
    expect(files.length).toBe(2)
    expect(files.map(file => file.kind).sort()).toEqual(['bib', 'tex'])
    expect(summary).toContain('Hello world')
  })

  it('classifies md/txt/sty files and skips extension-less entries', async () => {
    const { files, summary } = await extractSource(bytes(TARBALL2_B64), { maxFileChars: 1000, maxSummaryChars: 1000 })
    const byPath = new Map(files.map(file => [file.path, file.kind]))
    expect(byPath.get('src/notes.md')).toBe('text')
    expect(byPath.get('src/readme.txt')).toBe('text')
    expect(byPath.get('src/macros.sty')).toBe('other')
    expect(byPath.get('src/paper.tex')).toBe('tex')
    expect(byPath.has('src/Makefile')).toBe(false)
    expect(summary).toContain('Intro')
  })

  it('returns an empty summary when the tarball has no tex source', async () => {
    const { files, summary } = await extractSource(bytes(TARBALL3_B64), { maxFileChars: 1000, maxSummaryChars: 1000 })
    expect(files.length).toBe(1)
    expect(summary).toBe('')
  })

  it('picks the largest tex when no main.tex exists', async () => {
    const { summary } = await extractSource(bytes(TARBALL4_B64), { maxFileChars: 1000, maxSummaryChars: 1000 })
    expect(summary).toContain('longer body')
  })
})

describe('extractPdfText', () => {
  it('extracts text from PDF bytes', async () => {
    const text = await extractPdfText(bytes(PDF_B64))
    expect(text).toContain('Hello PDF')
  })
  it('rejects non-PDF input', async () => {
    await expect(extractPdfText(new Uint8Array([1, 2, 3]))).rejects.toThrow(LiteratureError)
  })
})

describe('pdfItemText', () => {
  it('returns the str for text items and empty for marked content', () => {
    expect(pdfItemText({ str: 'hello' })).toBe('hello')
    expect(pdfItemText({})).toBe('')
  })
})

describe('htmlToMarkdown', () => {
  it('converts HTML to Markdown', () => {
    expect(htmlToMarkdown('<h1>Title</h1><p>Hello <em>world</em>.</p>')).toBe('# Title\n\nHello _world_.')
  })
})

describe('minifyLandingPageHtml', () => {
  it('drops style, comments, and whitespace but keeps inline scripts verbatim', () => {
    const html = [
      '<!DOCTYPE html>',
      '<html><head>',
      '  <style>.big { color: red; }</style>',
      '  <!-- a comment -->',
      '  <script>var pdfUrl = "https://example.com/paper.pdf";\nif (x) { go(); }</script>',
      '</head><body>',
      '  <div class="big" style="padding:0">',
      '    <h1>  Title  </h1>',
      '  </div>',
      '</body></html>',
    ].join('\n')
    const out = minifyLandingPageHtml(html)
    expect(out).not.toContain('<style')
    expect(out).not.toContain('a comment')
    expect(out).not.toContain('style="padding')
    expect(out).toContain('var pdfUrl = "https://example.com/paper.pdf";')
    expect(out).not.toContain('  <h1')
  })

  it('removes conditional comments', () => {
    const out = minifyLandingPageHtml('<html><!--[if IE]><p>legacy</p><![endif]--><body>x</body></html>')
    expect(out).not.toContain('legacy')
  })

  it('keeps inline script bodies and link-bearing header/nav/noscript content', () => {
    const html = [
      '<html><head><style>.x{}</style>',
      '<script>window.location = "https://example.com/paper.pdf";</script></head>',
      '<body><header><a href="https://example.com/header.pdf">Header PDF</a></header>',
      '<nav><a href="https://example.com/nav.pdf">Nav PDF</a></nav>',
      '<noscript><a href="https://example.com/fallback.pdf">Fallback PDF</a></noscript>',
      '<main><h1>Title</h1></main></body></html>',
    ].join('')
    const out = minifyLandingPageHtml(html)
    expect(out).toContain('https://example.com/paper.pdf')
    expect(out).toContain('https://example.com/header.pdf')
    expect(out).toContain('https://example.com/nav.pdf')
    expect(out).toContain('https://example.com/fallback.pdf')
    expect(out).not.toContain('<style')
  })
})

describe('LiteratureError', () => {
  it('carries its code and optional cause', () => {
    const cause = new Error('boom')
    const error = new LiteratureError('message', 'LITERATURE_FETCH_FAILED', { cause })
    expect(error.name).toBe('LiteratureError')
    expect(error.code).toBe('LITERATURE_FETCH_FAILED')
    expect(error.cause).toBe(cause)
  })
})
