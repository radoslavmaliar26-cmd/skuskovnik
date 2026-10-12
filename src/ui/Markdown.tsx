import DOMPurify from 'dompurify'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { marked } from 'marked'
import { useMemo } from 'react'

marked.setOptions({ gfm: true, breaks: true })

const PH = (i: number) => `KTXPH${i}XEND`

function renderMath(expr: string, display: boolean): string {
  try {
    return katex.renderToString(expr, { displayMode: display, throwOnError: false, output: 'html', trust: false, strict: 'ignore' })
  } catch {
    return `<code>${expr.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!)}</code>`
  }
}

/** Markdown + LaTeX ($...$, $$...$$) → bezpečné HTML (všetko od AI sa sanitizuje). */
export function renderMarkdown(text: string, inline = false): string {
  const math: string[] = []
  let src = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, e: string) => {
    math.push(renderMath(e.trim(), true))
    return PH(math.length - 1)
  })
  src = src.replace(/\\\[([\s\S]+?)\\\]/g, (_, e: string) => {
    math.push(renderMath(e.trim(), true))
    return PH(math.length - 1)
  })
  // bez lookbehind – starší Safari (iOS < 16.4) ho nepozná
  src = src.replace(/(^|[^\\$])\$(?!\s)([^$\n]*?[^\s$\\])\$(?!\d)/g, (_, pre: string, e: string) => {
    math.push(renderMath(e, false))
    return pre + PH(math.length - 1)
  })
  src = src.replace(/\\\((.+?)\\\)/g, (_, e: string) => {
    math.push(renderMath(e, false))
    return PH(math.length - 1)
  })
  let html = (inline ? marked.parseInline(src, { async: false }) : marked.parse(src, { async: false })) as string
  html = html.replace(/KTXPH(\d+)XEND/g, (_, i: string) => math[Number(i)] ?? '')
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] })
}

export function Md({ text, inline, className }: { text: string; inline?: boolean; className?: string }) {
  const html = useMemo(() => renderMarkdown(text ?? '', inline), [text, inline])
  if (inline) return <span className={`md ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} />
  return <div className={`md ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} />
}

/** Samostatný LaTeX vzorec. */
export function Tex({ latex, display = true }: { latex: string; display?: boolean }) {
  const html = useMemo(() => DOMPurify.sanitize(renderMath(latex, display)), [latex, display])
  return <span dangerouslySetInnerHTML={{ __html: html }} />
}
