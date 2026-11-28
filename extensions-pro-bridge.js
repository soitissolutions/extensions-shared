/** @param {number} extensionsProId */
export async function startExtensionsProBridge(extensionsProId) {
  const {
    ACCOUNT_LINKED_MESSAGE,
    ACCOUNT_UNLINKED_MESSAGE,
    get,
    isTargetExtensionMessage,
    sendMessage,
    SERVER_ORIGIN,
  } = await import('./settings.js')

  async function announcePresence() {
    const { token } = await get('token')
    window.postMessage(
      {
        type: 'EXT_PRESENT',
        extensionsProId,
        linked: Boolean(token),
        runtimeId: chrome.runtime.id,
      },
      SERVER_ORIGIN,
    )
  }

  async function handleMessage(event) {
    if (event.origin !== SERVER_ORIGIN) return

    if (event.data?.type === 'EXT_PING') {
      await announcePresence()
      return
    }

    if (
      event.data?.type === 'EXT_LINK' &&
      isTargetExtensionMessage(event.data, chrome.runtime.id, extensionsProId)
    ) {
      await acknowledgeAction('EXT_LINK_ACK', () =>
        sendMessage({
          type: ACCOUNT_LINKED_MESSAGE,
          email: event.data.email,
          token: event.data.token,
        }),
      )
    }

    if (
      event.data?.type === 'EXT_UNLINK' &&
      isTargetExtensionMessage(event.data, chrome.runtime.id, extensionsProId)
    ) {
      await acknowledgeAction('EXT_UNLINK_ACK', () =>
        sendMessage({ type: ACCOUNT_UNLINKED_MESSAGE }),
      )
    }
  }

  async function acknowledgeAction(type, action) {
    let error
    try {
      const response = await action()
      if (!response || response.error) throw new Error('Extension operation failed')
    } catch {
      error = 'Could not update the extension link. Please try again.'
    }
    window.postMessage(
      {
        type,
        extensionId: extensionsProId,
        runtimeId: chrome.runtime.id,
        ...(error ? { error } : {}),
      },
      SERVER_ORIGIN,
    )
  }

  window.addEventListener('message', (event) =>
    handleMessage(event).catch(() =>
      console.error('[extensions-pro-bridge] Message handling failed'),
    ),
  )

  await announcePresence()
}
