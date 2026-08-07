import { invoke } from '@tauri-apps/api/core'

const CURRENT_VERSION = '0.3.6'
const dashboardUrl = 'http://127.0.0.1:8790'
const manifestUrl = 'https://loopbase.io/api/station-agent/releases/latest'

const statusEl = document.querySelector('#status')
const fallbackEl = document.querySelector('#fallback')
const updateBannerEl = document.querySelector('#updateBanner')
const updateTitleEl = document.querySelector('#updateTitle')
const updateNotesEl = document.querySelector('#updateNotes')
const updateNowEl = document.querySelector('#updateNow')

let availableUpdate = null

function compareVersions(left, right) {
  const a = String(left || '').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const b = String(right || '').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

function setStatus(message) {
  if (statusEl) statusEl.textContent = message
}

async function waitForAgent() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const ready = await invoke('station_agent_status')
      if (ready) {
        setStatus('Station Agent is ready. Use Open Station Dashboard when you need the local controls.')
        fallbackEl?.classList.remove('hidden')
        return
      }
    } catch {
      try {
        const response = await fetch(`${dashboardUrl}/status`, { cache: 'no-store' })
        if (response.ok) {
          setStatus('Station Agent is ready. Use Open Station Dashboard when you need the local controls.')
          fallbackEl?.classList.remove('hidden')
          return
        }
      } catch {
        // The Python service is still starting.
      }
    }

    setStatus(`Starting Station Agent... ${attempt + 1}/120`)
    if (attempt >= 10) fallbackEl?.classList.remove('hidden')
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  setStatus('Station Agent did not respond. Check Windows security/firewall or whether port 8790 is already in use.')
  fallbackEl?.classList.remove('hidden')
}

async function checkForUpdates() {
  try {
    const response = await fetch(manifestUrl, { cache: 'no-store' })
    if (!response.ok) return
    const manifest = await response.json()
    const latestVersion = manifest?.version
    const downloadUrl = manifest?.download_url
    if (!latestVersion || !downloadUrl || compareVersions(latestVersion, CURRENT_VERSION) <= 0) {
      return
    }

    availableUpdate = manifest
    updateTitleEl.textContent = `Loopbase Station Agent ${latestVersion} is ready`
    updateNotesEl.textContent = `Current version: ${CURRENT_VERSION}. This will download and install inside the Windows app. Saved station settings will be kept.`
    updateBannerEl?.classList.remove('hidden')
  } catch {
    // Update checks are non-blocking. The local station should still run.
  }
}

updateNowEl?.addEventListener('click', async () => {
  if (!availableUpdate?.download_url) return
  const confirmed = window.confirm(
    `Update Loopbase Station Agent to ${availableUpdate.version}? This will download the installer, close this app, and start the installer. Saved station settings will be kept.`
  )
  if (!confirmed) return

  updateNowEl.disabled = true
  updateNowEl.textContent = 'Updating...'
  setStatus('Downloading Station Agent update...')

  try {
    const message = await invoke('install_station_agent_update', {
      downloadUrl: availableUpdate.download_url,
      version: availableUpdate.version || 'latest',
    })
    setStatus(message)
  } catch (error) {
    updateNowEl.disabled = false
    updateNowEl.textContent = 'Update Now'
    setStatus(`Update failed: ${error}`)
  }
})

waitForAgent()
checkForUpdates()
