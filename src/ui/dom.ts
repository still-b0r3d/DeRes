// A tiny element builder. No inline style attributes on purpose: the
// Content-Security-Policy blocks them. Dynamic styles go through el.style.

type Child = Node | string | null | undefined | false
type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue
    if (key === 'style') throw new Error('Use el.style, not a style attribute')
    if (typeof value === 'function') {
      el.addEventListener(key.replace(/^on/, ''), value)
    } else if (value === true) {
      el.setAttribute(key, '')
    } else {
      el.setAttribute(key, String(value))
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    el.append(child)
  }
  return el
}

/** Shows or hides an element (the `hidden` attribute). */
export function show(el: HTMLElement, visible: boolean): void {
  el.hidden = !visible
}

/** A set of buttons where one is chosen (aria-pressed). */
export function segmented<T extends string>(
  label: string,
  options: readonly { value: T; text: string }[],
  onPick: (value: T) => void
): { el: HTMLElement; set: (value: T) => void; buttons: Map<T, HTMLButtonElement> } {
  const buttons = new Map<T, HTMLButtonElement>()
  const group = h('div', { class: 'seg', role: 'group', 'aria-label': label })
  for (const o of options) {
    const b = h('button', { type: 'button', 'data-value': o.value, onclick: () => onPick(o.value) }, o.text)
    buttons.set(o.value, b)
    group.append(b)
  }
  return {
    el: group,
    buttons,
    set(value) {
      for (const [v, b] of buttons) b.setAttribute('aria-pressed', String(v === value))
    }
  }
}

/** A labelled slider with its value shown. */
export function slider(o: {
  label: string
  min: number
  max: number
  step: number
  format: (v: number) => string
  onInput: (v: number) => void
  id: string
}): { el: HTMLElement; set: (v: number) => void; input: HTMLInputElement } {
  const input = h('input', { type: 'range', id: o.id, min: o.min, max: o.max, step: o.step })
  const out = h('output', { for: o.id })
  input.addEventListener('input', () => {
    const v = Number(input.value)
    out.textContent = o.format(v)
    o.onInput(v)
  })
  const el = h('div', { class: 'slider' }, h('label', { for: o.id }, o.label), out, input)
  return {
    el,
    input,
    set(v) {
      input.value = String(v)
      out.textContent = o.format(v)
    }
  }
}
