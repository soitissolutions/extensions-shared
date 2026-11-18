import { createRequire } from 'node:module'

import { expect, test, vi } from 'vitest'

import { renderOptionsComponents } from './helpers/options-components.js'

const require = createRequire(import.meta.url)
const { parseDocument } = require('htmlparser2')
const { selectAll, selectOne } = require('css-select')

test('missing translations use attribute text without interpreting it as markup', () => {
  const tree = parseDocument(`
    <options-toggle name="example" label="A &amp; B" info="&lt;b&gt;Info&lt;/b&gt;"></options-toggle>
  `)
  renderOptionsComponents(tree, { getMessage: () => '' })
  expect(selectOne('#example', tree).textContent).toBe('A & B')
  expect(selectOne('#exampleInfo', tree).textContent).toBe('<b>Info</b>')
  expect(selectAll('b', tree)).toHaveLength(0)
  expect(selectOne('input', tree).attribs['aria-describedby']).toBe('exampleInfo')
})

test('selects retain authored choices and native control state when reconnected', () => {
  const tree = parseDocument(`
    <options-select name="example" label="Example">
      <option value="ignore" selected>Default choice</option>
      <optgroup label="Other choices"><option value="custom" label-key="customChoice">Custom choice</option></optgroup>
      <option value="untranslated">Keep this text</option>
    </options-select>
  `)
  const host = selectOne('options-select', tree)
  const choices = selectAll('option', host)
  const group = selectOne('optgroup', host)
  const getMessage = vi.fn(
    (key) => ({ option_ignore: 'Ignore', customChoice: 'Translated' })[key] || '',
  )
  const component = renderOptionsComponents(tree, { getMessage })
  const select = selectOne('select', host)
  expect(selectAll('option', select)).toEqual(choices)
  expect(selectOne('optgroup', select)).toBe(group)
  expect(choices.map((choice) => choice.textContent)).toEqual([
    'Ignore',
    'Translated',
    'Keep this text',
  ])
  expect(choices[0].attribs).toHaveProperty('selected')
  expect(choices.map((choice) => choice.attribs.value)).toEqual([
    'ignore',
    'custom',
    'untranslated',
  ])
  select.value = 'custom'
  select.disabled = true
  choices[1].textContent = 'Updated by options.js'
  const change = vi.fn()
  select.onchange = change
  getMessage.mockClear()
  component.reconnect(host)
  expect(selectOne('select', host)).toBe(select)
  expect(select.value).toBe('custom')
  expect(select.disabled).toBe(true)
  expect(select.onchange).toBe(change)
  expect(choices[1].textContent).toBe('Updated by options.js')
  expect(getMessage).not.toHaveBeenCalled()
})

test('action buttons retain page handlers and dynamic popup text when reconnected', () => {
  const tree = parseDocument(`
    <options-button name="import" label="Import settings" label-key="importSettings" button="Import"></options-button>
  `)
  const component = renderOptionsComponents(tree)
  const host = selectOne('options-button', tree)
  const button = selectOne('button', host)
  button.textContent = 'Open options page'
  button.disabled = true
  button.onclick = vi.fn()
  const click = button.onclick
  component.reconnect(host)
  expect(selectOne('button', host)).toBe(button)
  expect(button.textContent).toBe('Open options page')
  expect(button.disabled).toBe(true)
  expect(button.onclick).toBe(click)
  expect(button.attribs.type).toBe('button')
})

test('buttons generate optional descriptions from their label locale key or name', () => {
  const tree = parseDocument(`<div>
    <options-button name="import" label-key="importSettings" info></options-button>
    <options-button name="action" info></options-button>
    <options-button name="plain"></options-button>
  </div>`)
  const component = renderOptionsComponents(tree, { getMessage: (key) => key })
  for (const [name, id] of [
    ['import', 'importSettingsInfo'],
    ['action', 'actionInfo'],
  ]) {
    const host = selectOne(`options-button[name=${name}]`, tree)
    expect(selectOne('.option-label', host).textContent).toBe(
      name == 'import' ? 'importSettings' : `${name}Label`,
    )
    const description = selectOne('.option-description', host)
    expect(description.attribs.id).toBe(id)
    expect(description.textContent).toBe(id)
    expect(selectOne('button', host).attribs['aria-describedby'].split(' ')).toContain(id)
    description.textContent = 'Updated description'
    component.reconnect(host)
    expect(selectOne('.option-description', host)).toBe(description)
    expect(description.textContent).toBe('Updated description')
  }
  expect(selectOne('.option-description', selectOne('options-button[name=plain]', tree))).toBeNull()
})

test('button initialization and reconnection preserve authored inputs and result nodes', () => {
  const tree = parseDocument(`<options-button name="import" label="Import settings" button="Import">
    <p class="option-description" id="importInfo">Authored description</p>
    <input type="file" hidden>
    <p class="option-message" id="result">Existing result</p>
  </options-button>`)
  const host = selectOne('options-button', tree)
  const input = selectOne('input', host)
  const description = selectOne('#importInfo', host)
  const message = selectOne('#result', host)
  const text = message.children[0]
  const listener = vi.fn()
  input.onchange = listener
  const component = renderOptionsComponents(tree)
  expect(selectOne('input', host)).toBe(input)
  expect(selectOne('#importInfo', host)).toBe(description)
  expect(description.textContent).toBe('Authored description')
  expect(selectOne('button', host).attribs['aria-describedby']).toBe('importLabel importInfo')
  expect(input.onchange).toBe(listener)
  expect(selectOne('#result', host)).toBe(message)
  expect(message.children[0]).toBe(text)
  message.textContent = 'Updated result'
  description.textContent = 'Updated description'
  component.reconnect(host)
  expect(selectOne('input', host)).toBe(input)
  expect(input.onchange).toBe(listener)
  expect(selectOne('#result', host)).toBe(message)
  expect(message.textContent).toBe('Updated result')
  expect(selectOne('#importInfo', host)).toBe(description)
  expect(description.textContent).toBe('Updated description')
  expect(selectAll('button', host)).toHaveLength(1)
})
