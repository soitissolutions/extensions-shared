export function normalizeFeatureSearch(text) {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Search rendered option labels/descriptions without reading user-entered values.
 * Call update() after feature visibility or page context changes; updateDisplay()
 * follows the consumer's active tab without discarding an open search's query.
 * @param {import('./types').FeatureSearchControllerOptions} options
 */
export function createFeatureSearchController({
  panel: $featurePanel,
  input: $featureSearchInput,
  row: $featureSearchRow,
  toggle: $featureSearchToggle,
  clear: $featureSearchClear,
  empty: $featureSearchEmpty,
  normalizeTerms = (text) => text,
  onOpen = () => {},
  onFilteringChange = () => {},
}) {
  const $body = $featurePanel.ownerDocument.body
  const document = $featurePanel.ownerDocument
  let filteringFeatures = false
  let featureSearchOpen = false
  let featureSearchEscapeHandled = false
  let connected = false

  /** Read only rendered explanatory text, never user-entered values. */
  function getFeatureSearchText($root) {
    if (!$root) return ''
    function read(node) {
      if (node.nodeType == 3) return node.textContent
      if (node.nodeType != 1) return ''
      const $element = /** @type {HTMLElement} */ (node)
      if (
        $element != $root &&
        $element.matches('section, .sub-options, details, input, textarea, button, script, style')
      )
        return ''
      if (getComputedStyle($element).display == 'none') return ''
      return Array.from($element.childNodes).map(read).join(' ')
    }
    return normalizeTerms(normalizeFeatureSearch(read($root)))
  }

  function updateFeatureSearch() {
    $featureSearchClear.hidden = $featureSearchInput.value.length == 0
    const terms = normalizeTerms(normalizeFeatureSearch($featureSearchInput.value))
      .split(/\s+/)
      .filter(Boolean)
    filteringFeatures = terms.length > 0
    $body.classList.toggle('filteringFeatures', filteringFeatures)
    for (const $hidden of $featurePanel.querySelectorAll('.feature-search-hidden')) {
      $hidden.classList.remove('feature-search-hidden')
    }
    onFilteringChange(filteringFeatures)
    if (!filteringFeatures) {
      $featureSearchEmpty.hidden = true
      return
    }

    const rows = Array.from($featurePanel.querySelectorAll('section:not(.group)')).filter(
      ($row) =>
        $row.closest('section.labelled') &&
        !$row.closest('details') &&
        $row.querySelector(':scope > :is(.option-label, .option-row)'),
    )
    const text = new Map(rows.map(($row) => [$row, getFeatureSearchText($row)]))
    const visible = new Set()
    const eligibleRows = new Set()
    for (const $row of rows) {
      let eligible = true
      let context = ''
      for (
        let $ancestor = $row;
        $ancestor && $ancestor != $featurePanel;
        $ancestor = $ancestor.parentElement
      ) {
        if (getComputedStyle($ancestor).display == 'none') {
          eligible = false
          break
        }
        context += ` ${text.get($ancestor) || ''}`
      }
      if (!eligible) continue
      eligibleRows.add($row)
      const $group = $row.closest('section.group')
      context += ` ${getFeatureSearchText($group)}`
      if (!terms.every((term) => context.includes(term))) continue
      for (
        let $ancestor = $row;
        $ancestor && $ancestor != $featurePanel;
        $ancestor = $ancestor.parentElement
      ) {
        if ($ancestor.matches('section')) visible.add($ancestor)
      }
    }
    for (const $row of rows) $row.classList.toggle('feature-search-hidden', !visible.has($row))
    // Intermediate controls such as bulk toggles only apply to complete sets.
    // Keep their containers for matching children, hiding just the control label.
    for (const $intermediate of $featurePanel.querySelectorAll('section.search-intermediate')) {
      const children = Array.from(
        $intermediate.querySelectorAll(':scope > .sub-options > section'),
      ).filter(($row) => eligibleRows.has($row))
      $intermediate
        .querySelector(':scope > :is(.option-label, .option-row)')
        .classList.toggle(
          'feature-search-hidden',
          children.length > 0 && !children.every(($row) => visible.has($row)),
        )
    }
    for (const $group of $featurePanel.querySelectorAll(':scope > section.labelled')) {
      $group.classList.toggle('feature-search-hidden', !visible.has($group))
    }
    $featureSearchEmpty.hidden = visible.size > 0
  }

  function setFeatureSearchOpen(open) {
    featureSearchOpen = open
    if (open) onOpen()
    $featureSearchRow.hidden = !open
    $featureSearchToggle.setAttribute('aria-expanded', String(open))
    if (open) $featureSearchInput.focus()
    else {
      $featureSearchInput.value = ''
      updateFeatureSearch()
      $featureSearchToggle.focus()
    }
  }

  function onFeatureSearchKeyDown(e) {
    if (e.defaultPrevented || e.isComposing) return
    if (e.key == '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const editing = e
        .composedPath()
        .some(
          ($target) => $target.matches?.('input, textarea, select') || $target.isContentEditable,
        )
      if (editing) return
      e.preventDefault()
      e.stopPropagation()
      setFeatureSearchOpen(true)
      return
    }
    if (!$featureSearchRow.contains(e.target) && e.target != $featureSearchToggle) return
    if (e.key == 'Enter' && e.target == $featureSearchInput) e.preventDefault()
    if (e.key != 'Escape' || $featureSearchRow.hidden) return
    e.preventDefault()
    e.stopPropagation()
    featureSearchEscapeHandled = true
    if (e.repeat) return
    if ($featureSearchInput.value) {
      $featureSearchInput.value = ''
      updateFeatureSearch()
      $featureSearchInput.focus()
    } else setFeatureSearchOpen(false)
  }

  function onFeatureSearchKeyUp(e) {
    if (e.key != 'Escape' || !featureSearchEscapeHandled) return
    featureSearchEscapeHandled = false
    // Closing search moves focus to its toggle before keyup, so consume that too
    e.preventDefault()
    e.stopPropagation()
  }

  function updateDisplay(active = true) {
    const showSearch = featureSearchOpen && active
    $featureSearchRow.hidden = !showSearch
    $featureSearchToggle.setAttribute('aria-expanded', String(showSearch))
  }

  function onToggle() {
    setFeatureSearchOpen($featureSearchRow.hidden)
  }
  function onClear() {
    $featureSearchInput.value = ''
    updateFeatureSearch()
    $featureSearchInput.focus()
  }

  function connect() {
    if (connected) return
    connected = true
    $featureSearchToggle.addEventListener('click', onToggle)
    $featureSearchInput.addEventListener('input', updateFeatureSearch)
    $featureSearchInput.addEventListener('search', updateFeatureSearch)
    $featureSearchClear.addEventListener('click', onClear)
    document.addEventListener('keydown', onFeatureSearchKeyDown, true)
    document.addEventListener('keyup', onFeatureSearchKeyUp, true)
  }

  function destroy() {
    if (!connected) return
    connected = false
    $featureSearchToggle.removeEventListener('click', onToggle)
    $featureSearchInput.removeEventListener('input', updateFeatureSearch)
    $featureSearchInput.removeEventListener('search', updateFeatureSearch)
    $featureSearchClear.removeEventListener('click', onClear)
    document.removeEventListener('keydown', onFeatureSearchKeyDown, true)
    document.removeEventListener('keyup', onFeatureSearchKeyUp, true)
  }

  return {
    connect,
    destroy,
    update: updateFeatureSearch,
    updateDisplay,
    setOpen: setFeatureSearchOpen,
    get isFiltering() {
      return filteringFeatures
    },
    get isOpen() {
      return featureSearchOpen
    },
  }
}
