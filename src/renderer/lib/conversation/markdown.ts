import DOMPurify from 'dompurify'
import { marked } from 'marked'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

// Only the languages Midas realistically shows are registered, so the bundle
// carries a curated set rather than every grammar highlight.js ships.
for (const [name, language] of Object.entries({
  bash, css, diff, go, java, javascript, json, markdown, php, python, ruby, rust, sql, typescript, xml, yaml,
})) hljs.registerLanguage(name, language)

const languageNames: Record<string, string> = {
  js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript',
  jsx: 'JSX', tsx: 'TSX', py: 'Python', python: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust',
  java: 'Java', cs: 'C#', cpp: 'C++', c: 'C', php: 'PHP', swift: 'Swift', kt: 'Kotlin',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', sql: 'SQL', json: 'JSON', yaml: 'YAML', yml: 'YAML',
  html: 'HTML', css: 'CSS', scss: 'SCSS', md: 'Markdown', markdown: 'Markdown', svelte: 'Svelte',
  vue: 'Vue', diff: 'Diff', xml: 'XML', toml: 'TOML',
}

const languageAliases: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', svelte: 'xml', vue: 'xml', html: 'xml',
  py: 'python', rb: 'ruby', rs: 'rust', sh: 'bash', zsh: 'bash', shell: 'bash',
  yml: 'yaml', md: 'markdown',
}

/** Reads the fenced language token from the code element's class. */
export function codeToken(pre: Element): string {
  const className = pre.querySelector('code')?.getAttribute('class') ?? ''
  return (/language-([A-Za-z0-9+#-]+)/.exec(className)?.[1] ?? '').toLowerCase()
}

export function codeLanguage(pre: Element): string {
  const token = codeToken(pre)
  if (!token) return 'Code'
  return languageNames[token] ?? token.toUpperCase()
}

/**
 * Highlighting runs on the sanitized DOM's text content and emits only
 * class-bearing spans, so it cannot reintroduce anything DOMPurify removed.
 */
function highlightCode(pre: Element): void {
  const code = pre.querySelector('code')
  if (!code) return
  const source = code.textContent ?? ''
  if (!source.trim()) return
  const token = codeToken(pre)
  const language = languageAliases[token] ?? token
  try {
    const highlighted = language && hljs.getLanguage(language)
      ? hljs.highlight(source, { language, ignoreIllegals: true })
      : hljs.highlightAuto(source)
    code.innerHTML = highlighted.value
    code.classList.add('hljs')
  } catch {
    // Leave the plain escaped code in place if highlighting fails.
  }
}

export function renderMarkdown(source: string): string {
  if (!source.trim()) return ''
  const rendered = marked.parse(source, {
    async: false,
    breaks: true,
    gfm: true,
  }) as string

  const sanitized = DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'svg', 'math'],
    FORBID_ATTR: ['style', 'srcset'],
  })

  const document = new DOMParser().parseFromString(sanitized, 'text/html')
  for (const anchor of document.querySelectorAll('a')) {
    anchor.setAttribute('rel', 'noopener noreferrer')
  }
  for (const pre of document.querySelectorAll('pre')) {
    const wrapper = document.createElement('div')
    wrapper.className = 'markdown-code-block'

    // A titled header carrying the fenced language and its own Copy action,
    // rather than a control floating over the first line of code.
    const header = document.createElement('div')
    header.className = 'markdown-code-header'
    const label = document.createElement('span')
    label.className = 'markdown-code-language'
    label.textContent = codeLanguage(pre)
    highlightCode(pre)
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'markdown-code-copy'
    copy.dataset.markdownCopy = ''
    copy.setAttribute('aria-label', 'Copy code')
    copy.textContent = 'Copy'
    header.append(label, copy)

    pre.replaceWith(wrapper)
    wrapper.append(header, pre)
  }
  return document.body.innerHTML
}
