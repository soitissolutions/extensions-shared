import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const { selectAll, selectOne } = require('css-select')
const { Element, Text } = require('domhandler')
const { appendChild, removeElement, textContent } = require('domutils')
const source = readFileSync(new URL('../../options-components.js', import.meta.url), 'utf8')

/** Render the real components using the DOM fixture used by options tests. */
export function renderOptionsComponents(tree, { getMessage = () => '' } = {}) {
  const components = new Map()
  vm.runInNewContext(source.replaceAll('export class', 'class'), {
    HTMLElement: class {},
    customElements: { define: (name, componentClass) => components.set(name, componentClass) },
    chrome: { i18n: { getMessage } },
  })
  const document = {
    createElement(name) {
      const element = new Element(name, {})
      decorate(element)
      return element
    },
  }
  function decorate(node) {
    if (node.type != 'tag') return
    node.ownerDocument = document
    node.querySelector = (selector) => selectOne(selector, node, { context: [node] })
    node.querySelectorAll = (selector) => selectAll(selector, node, { context: [node] })
    node.getAttribute = (key) => node.attribs[key] ?? null
    node.hasAttribute = (key) => key in node.attribs
    node.setAttribute = (key, value) => (node.attribs[key] = String(value))
    node.append = (...children) => {
      for (const child of children) appendChild(node, child)
    }
    node.replaceChildren = (...children) => {
      for (const child of [...node.children]) removeElement(child)
      node.append(...children)
    }
    node.classList = {
      add(...classes) {
        node.attribs.class = [...new Set([...(node.attribs.class || '').split(/\s+/), ...classes])]
          .filter(Boolean)
          .join(' ')
      },
    }
    Object.defineProperties(node, {
      childNodes: { configurable: true, get: () => node.children },
      id: {
        configurable: true,
        get: () => node.attribs.id || '',
        set: (value) => (node.attribs.id = value),
      },
      className: {
        configurable: true,
        get: () => node.attribs.class || '',
        set: (value) => (node.attribs.class = value),
      },
      htmlFor: {
        configurable: true,
        get: () => node.attribs.for || '',
        set: (value) => (node.attribs.for = value),
      },
      value: {
        configurable: true,
        get: () => node.attribs.value || '',
        set: (value) => (node.attribs.value = value),
      },
      textContent: {
        configurable: true,
        get: () => textContent(node),
        set: (value) => node.replaceChildren(new Text(value)),
      },
    })
    for (const child of node.children) decorate(child)
  }
  function connect(host) {
    components.get(host.name).prototype.connectedCallback.call(host)
  }
  for (const host of selectAll([...components.keys()].join(', '), tree)) {
    decorate(host)
    connect(host)
  }
  return { reconnect: connect }
}
