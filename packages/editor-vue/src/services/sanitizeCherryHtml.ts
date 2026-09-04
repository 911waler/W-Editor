import DOMPurify from 'dompurify'

const ALLOWED_TAGS = Object.freeze([
  'a',
  'audio',
  'blockquote',
  'br',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'details',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'input',
  'label',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  'rp',
  'rt',
  'ruby',
  's',
  'small',
  'source',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
  'video',
])

const ALLOWED_ATTRIBUTES = Object.freeze([
  'align',
  'alt',
  'aria-hidden',
  'aria-label',
  'checked',
  'class',
  'colspan',
  'controls',
  'data-change-lang',
  'data-chart-options',
  'data-chart-type',
  'data-copy-code',
  'data-edit-code',
  'data-expand-code',
  'data-lang',
  'data-lines',
  'data-sign',
  'data-table-data',
  'data-type',
  'disabled',
  'download',
  'for',
  'height',
  'href',
  'id',
  'loading',
  'loop',
  'muted',
  'name',
  'open',
  'poster',
  'preload',
  'rel',
  'rowspan',
  'src',
  'start',
  'style',
  'target',
  'title',
  'type',
  'width',
])

const ALLOWED_STYLE_PROPERTIES = Object.freeze([
  'background-color',
  'color',
  'font-size',
  'line-height',
  'position',
  'text-align',
])

export const CHERRY_SAFE_RENDER_POLICY = Object.freeze({
  allowedAttributes: ALLOWED_ATTRIBUTES,
  allowedDataImageMimeTypes: Object.freeze(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']),
  allowedHyperlinkSchemes: Object.freeze(['http:', 'https:', 'mailto:']),
  allowedMediaSchemes: Object.freeze(['http:', 'https:']),
  allowedStyleProperties: ALLOWED_STYLE_PROPERTIES,
  allowedTags: ALLOWED_TAGS,
})

const ALLOWED_STYLE_PROPERTY_SET = new Set<string>(ALLOWED_STYLE_PROPERTIES)
const SAFE_COLOR = /^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%+-]+\)|[a-z]+)$/i
const SAFE_LENGTH = /^(?:0|(?:\d+(?:\.\d+)?)(?:em|px|rem|%))$/i
const SAFE_LINE_HEIGHT = /^(?:normal|\d+(?:\.\d+)?(?:em|px|rem|%)?)$/i
const SAFE_RASTER_DATA_URL = /^data:image\/(?:avif|gif|jpeg|png|webp);base64,[a-z\d+/]+={0,2}$/i

const KATEX_CLASS_TOKENS = new Set([
  'accent', 'accent-body', 'accent-full', 'amsrm', 'angl', 'anglpad', 'arraycolsep', 'base',
  'boldsymbol', 'boxpad', 'brace-center', 'brace-left', 'brace-right', 'cancel-lap', 'cancel-pad',
  'cd-arrow-pad', 'cd-label-left', 'cd-label-right', 'cd-vert-arrow', 'clap', 'col-align-c',
  'col-align-l', 'col-align-r', 'delim-size1', 'delim-size4', 'delimcenter', 'delimsizing',
  'displaystyle', 'eqn-num', 'fbox', 'fcolorbox', 'fix', 'fleqn', 'fontsize-ensurer', 'frac-line',
  'halfarrow-left', 'halfarrow-right', 'hbox', 'hdashline', 'hide-tail', 'hline', 'inner', 'katex',
  'katex-display', 'katex-error', 'katex-html', 'katex-mathml', 'katex-version', 'large-op', 'leqno',
  'llap', 'mainrm', 'mathbb', 'mathbf', 'mathboldfrak', 'mathboldsf', 'mathcal', 'mathfrak',
  'mathit', 'mathitsf', 'mathnormal', 'mathrm', 'mathscr', 'mathsf', 'mathsfit', 'mathtt', 'mbin',
  'mclose', 'mfrac', 'minner', 'mml-eqn-num', 'mopen', 'mop', 'mord', 'mover', 'mpunct',
  'mrel', 'mspace', 'msupsub', 'mtable', 'mtight', 'mtr-glue', 'mult', 'munder', 'newline',
  'nulldelimiter', 'op-limits', 'op-symbol', 'overlay', 'overline', 'overline-line', 'pstrut',
  'rlap', 'root', 'rule', 'scriptstyle', 'scriptscriptstyle', 'sizing', 'small-op', 'smash', 'sout',
  'sqrt', 'stretchy', 'strut', 'svg-align', 'tag', 'textbb', 'textbf', 'textboldfrak', 'textboldsf',
  'textfrak', 'textit', 'textitsf', 'textrm', 'textscr', 'textsf', 'textstyle', 'texttt', 'thinbox',
  'underline', 'underline-line', 'vbox', 'vertical-separator', 'vlist', 'vlist-r', 'vlist-s',
  'vlist-t', 'vlist-t2', 'x-arrow', 'x-arrow-pad',
])

function isAllowedClassToken(token: string): boolean {
  return KATEX_CLASS_TOKENS.has(token)
    || /^reset-size(?:[1-9]|1[01])$/u.test(token)
    || /^size(?:[1-9]|1[01])$/u.test(token)
    || token === 'anchor'
    || token === 'check-list-item'
    || token === 'code-line'
    || token === 'toc'
    || token === 'toc-li'
    || token === 'toc-title'
    || token === 'token'
    || /^cherry-[a-z\d_-]+$/i.test(token)
    || /^ch-icon(?:-[a-z\d_-]+)?$/i.test(token)
    || /^language-[a-z\d_-]+$/i.test(token)
    || /^level-\d+$/i.test(token)
}

function filterClasses(element: Element): void {
  if (!element.hasAttribute('class')) return
  const original = element.getAttribute('class') ?? ''
  const hasTokenClass = original.split(/\s+/u).includes('token')
  const allowed = original
    .split(/\s+/u)
    .filter(Boolean)
    .filter((token) => isAllowedClassToken(token) || (hasTokenClass && /^[a-z][a-z\d_-]*$/i.test(token)))
  if (allowed.length === 0) {
    element.removeAttribute('class')
  } else {
    element.setAttribute('class', allowed.join(' '))
  }
}

function isSafeStyleValue(property: string, value: string): boolean {
  if (/[\\@]|(?:expression|url)\s*\(/iu.test(value)) return false
  switch (property) {
    case 'background-color':
    case 'color':
      return SAFE_COLOR.test(value)
    case 'font-size':
      return SAFE_LENGTH.test(value)
    case 'line-height':
      return SAFE_LINE_HEIGHT.test(value)
    case 'position':
      return value === 'relative' || value === 'static'
    case 'text-align':
      return ['center', 'justify', 'left', 'right', 'start', 'end'].includes(value)
    default:
      return false
  }
}

function filterStyle(element: HTMLElement): void {
  if (!element.hasAttribute('style')) return
  const original = element.getAttribute('style') ?? ''
  const originalValues = new Map(original
    .split(';')
    .map((declaration) => declaration.split(/:(.*)/su))
    .filter((parts): parts is [string, string] => parts.length >= 2)
    .map(([property, value]) => [property.trim().toLowerCase(), value.trim()]))
  const safeDeclarations: Array<readonly [string, string]> = []
  let everyDeclarationIsSafe = true

  for (let index = 0; index < element.style.length; index += 1) {
    const property = element.style.item(index).toLowerCase()
    const value = element.style.getPropertyValue(property).trim()
    const originalValue = originalValues.get(property) ?? value
    if (ALLOWED_STYLE_PROPERTY_SET.has(property) && isSafeStyleValue(property, value) && isSafeStyleValue(property, originalValue)) {
      safeDeclarations.push([property, originalValue])
    } else {
      everyDeclarationIsSafe = false
    }
  }

  if (safeDeclarations.length === 0) {
    element.removeAttribute('style')
    return
  }
  if (everyDeclarationIsSafe) return
  element.setAttribute('style', safeDeclarations.map(([property, value]) => `${property}: ${value};`).join(' '))
  if (original.length === 0) element.removeAttribute('style')
}

function isAllowedUrl(
  attribute: 'href' | 'poster' | 'src',
  value: string,
  element: Element,
  ownerDocument: Document,
): boolean {
  if (attribute === 'src' && element.tagName === 'IMG' && SAFE_RASTER_DATA_URL.test(value)) return true
  if (attribute === 'href' && value.startsWith('#')) return true
  try {
    const parsed = new URL(value, ownerDocument.baseURI)
    return attribute === 'href'
      ? CHERRY_SAFE_RENDER_POLICY.allowedHyperlinkSchemes.includes(parsed.protocol)
      : CHERRY_SAFE_RENDER_POLICY.allowedMediaSchemes.includes(parsed.protocol)
  } catch {
    return false
  }
}

function filterUrls(element: Element, ownerDocument: Document): void {
  for (const attribute of ['href', 'poster', 'src'] as const) {
    const value = element.getAttribute(attribute)
    if (value !== null && !isAllowedUrl(attribute, value, element, ownerDocument)) {
      element.removeAttribute(attribute)
    }
  }

  if (element.tagName === 'A') {
    const target = element.getAttribute('target')
    if (target !== null && target !== '_blank' && target !== '_self') {
      element.removeAttribute('target')
    }
    if (target === '_blank') {
      element.setAttribute('rel', 'noopener noreferrer')
    }
  }
}

function constrainInput(element: Element): void {
  if (element.tagName !== 'INPUT') return
  const type = element.getAttribute('type')?.toLowerCase()
  if (type === 'checkbox') {
    element.setAttribute('disabled', '')
    return
  }
  const id = element.getAttribute('id') ?? ''
  const name = element.getAttribute('name') ?? ''
  const safeTabsRadio = type === 'radio'
    && element.classList.contains('cherry-tabs--radio')
    && /^[a-z\d_-]+$/iu.test(id)
    && /^[a-z\d_-]+$/iu.test(name)
  if (!safeTabsRadio) element.remove()
}

export function sanitizeCherryHtml(html: string, ownerDocument: Document = document): string {
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_ATTR: [...ALLOWED_ATTRIBUTES],
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
  })
  const template = ownerDocument.createElement('template')
  template.innerHTML = sanitized
  for (const element of [...template.content.querySelectorAll('*')]) {
    constrainInput(element)
    if (!element.isConnected && element.parentNode === null) continue
    filterClasses(element)
    filterStyle(element as HTMLElement)
    filterUrls(element, ownerDocument)
  }
  return template.innerHTML
}
