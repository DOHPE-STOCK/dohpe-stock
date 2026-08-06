const statusEl = document.querySelector('#status')
const fallbackEl = document.querySelector('#fallback')
const dashboardUrl = 'http://127.0.0.1:8790'

async function waitForAgent() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${dashboardUrl}/status`, { cache: 'no-store' })
      if (response.ok) {
        statusEl.textContent = 'Station Agent is ready. Opening dashboard...'
        window.location.href = dashboardUrl
        return
      }
    } catch {
      // The Python service is still starting.
    }
    statusEl.textContent = `Starting Station Agent... ${attempt + 1}/120`
    if (attempt >= 10) fallbackEl?.classList.remove('hidden')
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  statusEl.textContent = 'Station Agent did not respond to the readiness check. Trying the local dashboard directly...'
  window.location.href = dashboardUrl
}

waitForAgent()
