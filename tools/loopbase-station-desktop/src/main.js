const statusEl = document.querySelector('#status')

async function waitForAgent() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:8790/status', { cache: 'no-store' })
      if (response.ok) {
        statusEl.textContent = 'Station Agent is ready. Opening dashboard...'
        window.location.href = 'http://127.0.0.1:8790'
        return
      }
    } catch {
      // The Python service is still starting.
    }
    statusEl.textContent = `Starting Station Agent... ${attempt + 1}/60`
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  statusEl.textContent = 'Station Agent did not respond. Check that the companion service is allowed by Windows Defender.'
}

waitForAgent()
