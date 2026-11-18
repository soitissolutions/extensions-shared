import { readFileSync } from 'node:fs'
import vm from 'node:vm'

import { is, selectAll, selectOne } from 'css-select'
import { Text } from 'domhandler'
import { appendChild, removeElement, textContent } from 'domutils'
import { parseDocument } from 'htmlparser2'
import { expect, test, vi } from 'vitest'

import { normalizeFeatureSearch } from '../feature-search-controller.js'

const source = readFileSync(
  new URL('../feature-search-controller.js', import.meta.url),
  'utf8',
).replace(/^export /gm, '')

function load(options = {}) {
  const tree = parseDocument(`<body>
    <button id="toggle"></button><div id="row" hidden><input id="query"><button id="clear"></button></div>
    <p id="empty" hidden>No matches</p><div id="panel" class="panel" data-tab="features">
      <section class="group labelled"><label>Appearance</label><div class="options">
        <section id="parent" class="option"><div class="option-row">Colour controls</div>
          <div class="sub-options requires-setting"><section id="child" class="option"><div class="option-row">Café accent</div></section></div>
        </section>
        <section id="blocked" class="option incompatible"><div class="option-row">Unavailable</div>
          <div class="sub-options"><section id="blocked-child" class="option"><div class="option-row">Exclusive accent</div></section></div>
        </section>
        <section id="text" class="option"><div class="option-row">Custom styles</div><textarea>private-value</textarea></section>
      </div></section>
    </div></body>`)
  const query = (selector) => selectOne(selector, tree)
  const document = { body: null, listeners: new Map(), activeElement: null }
  function events(node) {
    node.listeners ||= new Map()
    node.addEventListener = (type, callback) => {
      const listeners = node.listeners.get(type) || new Set()
      listeners.add(callback)
      node.listeners.set(type, listeners)
    }
    node.removeEventListener = (type, callback) => node.listeners.get(type)?.delete(callback)
    node.fire = (type, event = {}) => {
      for (const listener of node.listeners.get(type) || []) listener(event)
    }
  }
  events(document)
  function decorate(node) {
    if (node.type === 'text') {
      Object.defineProperties(node, {
        nodeType: { value: 3 },
        textContent: { get: () => node.data },
      })
      return
    }
    if (node.type !== 'tag') {
      for (const child of node.children || []) decorate(child)
      return
    }
    events(node)
    node.ownerDocument = document
    node.matches = (selector) => is(node, selector)
    node.querySelector = (selector) => selectOne(selector, node, { context: [node] })
    node.querySelectorAll = (selector) => selectAll(selector, node, { context: [node] })
    node.closest = (selector) => {
      for (let current = node; current; current = current.parentElement)
        if (current.matches(selector)) return current
      return null
    }
    node.contains = (other) => {
      for (let current = other; current; current = current.parentElement)
        if (current === node) return true
      return false
    }
    node.focus = () => {
      document.activeElement = node
    }
    node.value = ''
    node.setAttribute = (name, value) => {
      node.attribs[name] = value
    }
    node.classList = {
      contains: (name) => (node.attribs.class || '').split(/\s+/).includes(name),
      toggle(name, enabled) {
        const values = new Set((node.attribs.class || '').split(/\s+/).filter(Boolean))
        if (enabled) values.add(name)
        else values.delete(name)
        node.attribs.class = [...values].join(' ')
      },
      remove(name) {
        this.toggle(name, false)
      },
    }
    Object.defineProperties(node, {
      nodeType: { value: 1 },
      parentElement: { get: () => (node.parent?.type === 'tag' ? node.parent : null) },
      hidden: {
        get: () => 'hidden' in node.attribs,
        set: (hidden) => {
          if (hidden) node.attribs.hidden = ''
          else delete node.attribs.hidden
        },
      },
      textContent: {
        get: () => textContent(node),
        set: (value) => {
          for (const child of [...node.children]) removeElement(child)
          const child = new Text(value)
          decorate(child)
          appendChild(node, child)
        },
      },
    })
    for (const child of node.children) decorate(child)
  }
  decorate(tree)
  document.body = query('body')
  const onOpen = vi.fn()
  const onFilteringChange = vi.fn()
  const create = vm.runInNewContext(`${source}\ncreateFeatureSearchController`, {
    getComputedStyle(node) {
      const blocked = node.closest('.incompatible')
      const conditional =
        node.matches('.requires-setting') && !document.body.classList.contains('filteringFeatures')
      return {
        display:
          blocked || conditional || node.hidden || node.classList.contains('feature-search-hidden')
            ? 'none'
            : 'block',
      }
    },
  })
  const search = create({
    panel: query('#panel'),
    input: query('#query'),
    row: query('#row'),
    toggle: query('#toggle'),
    clear: query('#clear'),
    empty: query('#empty'),
    onOpen,
    onFilteringChange,
    ...options,
  })
  search.connect()
  return {
    search,
    query,
    document,
    onOpen,
    onFilteringChange,
    filter(value) {
      query('#query').value = value
      query('#query').fire('input')
    },
  }
}

test('generic normalisation supports Unicode without assuming product terminology', () => {
  expect(normalizeFeatureSearch('CAFÉ — メトリクス!')).toBe('cafe メトリクス')
  expect(normalizeFeatureSearch('posts reposts')).toBe('posts reposts')
})

test('search reveals dependencies while keeping incompatible descendants excluded', () => {
  const page = load()
  page.filter('accent')
  expect(page.search.isFiltering).toBe(true)
  expect(page.query('#child').classList.contains('feature-search-hidden')).toBe(false)
  expect(page.query('#parent').classList.contains('feature-search-hidden')).toBe(false)
  expect(page.query('#blocked-child').classList.contains('feature-search-hidden')).toBe(true)
  expect(page.query('#empty').hidden).toBe(true)
  page.filter('exclusive')
  expect(page.query('#empty').hidden).toBe(false)
  page.filter('')
  expect(page.search.isFiltering).toBe(false)
  expect(page.query('#empty').hidden).toBe(true)
  expect(page.onFilteringChange).toHaveBeenLastCalledWith(false)
})

test('consumer aliases are applied to queries and explanatory text, never user input', () => {
  const page = load({ normalizeTerms: (text) => text.replace(/\bcolor\b/g, 'colour') })
  page.filter('color')
  expect(page.query('#parent').classList.contains('feature-search-hidden')).toBe(false)
  page.filter('private-value')
  expect(page.query('#empty').hidden).toBe(false)
})

test('keyboard handling opens search and Escape clears then closes without losing tab state', () => {
  const page = load()
  const key = (name) => ({
    key: name,
    target: page.query('#query'),
    composedPath: () => [],
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  })
  page.document.fire('keydown', key('/'))
  expect(page.onOpen).toHaveBeenCalledOnce()
  expect(page.document.activeElement).toBe(page.query('#query'))
  page.filter('accent')
  page.search.updateDisplay(false)
  expect(page.query('#row').hidden).toBe(true)
  page.search.updateDisplay(true)
  expect(page.query('#query').value).toBe('accent')
  page.document.fire('keydown', key('Escape'))
  expect(page.query('#query').value).toBe('')
  expect(page.search.isOpen).toBe(true)
  page.document.fire('keydown', key('Escape'))
  expect(page.search.isOpen).toBe(false)
  expect(page.document.activeElement).toBe(page.query('#toggle'))
  const release = key('Escape')
  page.document.fire('keyup', release)
  expect(release.preventDefault).toHaveBeenCalledOnce()
})

test('listeners are installed once and can be removed for consumer teardown', () => {
  const page = load()
  page.search.connect()
  expect(page.document.listeners.get('keydown').size).toBe(1)
  page.search.destroy()
  expect(page.document.listeners.get('keydown').size).toBe(0)
  expect(page.query('#query').listeners.get('input').size).toBe(0)
  page.search.connect()
  page.filter('accent')
  expect(page.search.isFiltering).toBe(true)
})
