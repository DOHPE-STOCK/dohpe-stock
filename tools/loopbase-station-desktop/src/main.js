const CURRENT_VERSION = '0.3.13'
const dashboardUrl = 'http://127.0.0.1:8790'
const manifestUrl = 'https://loopbase.io/api/station-agent/releases/latest'
const invoke = window.__TAURI__?.core?.invoke

const statusEl = document.querySelector('#status')
const updateBannerEl = document.querySelector('#updateBanner')
const updateTitleEl = document.querySelector('#updateTitle')
const updateNotesEl = document.querySelector('#updateNotes')
const updateNowEl = document.querySelector('#updateNow')
const connectionBadgeEl = document.querySelector('#connectionBadge')
const setupPanelEl = document.querySelector('#setupPanel')
const setupFormEl = document.querySelector('#setupForm')
const stationNameEl = document.querySelector('#stationName')
const stationTokenEl = document.querySelector('#stationToken')
const appUrlEl = document.querySelector('#appUrl')
const moduleGridEl = document.querySelector('#moduleGrid')
const saveSetupEl = document.querySelector('#saveSetup')

let availableUpdate = null
let statusFadeTimer = null

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
  if (!statusEl) return
  clearTimeout(statusFadeTimer)
  statusEl.textContent = message
  statusEl.classList.remove('status-faded')
}

function fadeStatusSoon() {
  if (!statusEl) return
  clearTimeout(statusFadeTimer)
  statusFadeTimer = setTimeout(() => {
    statusEl.classList.add('status-faded')
  }, 2000)
}

function setBadge(message, className = '') {
  if (!connectionBadgeEl) return
  connectionBadgeEl.textContent = message
  connectionBadgeEl.className = `connection-badge ${className}`.trim()
}

function renderStationConfig(config) {
  if (appUrlEl && config?.app_url) appUrlEl.value = config.app_url
  if (stationNameEl) {
    stationNameEl.value = config?.connected && config?.station_name ? config.station_name : ''
  }

  if (config?.connected) {
    setBadge(config.display_station_name || config.station_name || 'Station connected', 'connected')
    setupPanelEl?.classList.add('hidden')
    moduleGridEl?.classList.remove('hidden')
    setStatus('Station connected.')
    fadeStatusSoon()
    return
  }

  setBadge('Token required', 'needs-token')
  moduleGridEl?.classList.add('hidden')
  setupPanelEl?.classList.remove('hidden')
  setStatus('Enter the station token for this device to connect Loopbase services.')
}

async function loadStationConfig() {
  const response = await fetch(`${dashboardUrl}/desktop/config`, { cache: 'no-store' })
  const config = await response.json()
  if (!response.ok || !config?.ok) {
    throw new Error(config?.message || 'Could not load station settings.')
  }
  renderStationConfig(config)
}

async function waitForAgent() {
  if (!invoke) {
    setStatus('Station Agent desktop API did not load. Close Loopbase from the system tray, install the latest build, then open it again.')
    setBadge('Desktop API failed')
    return
  }

  try {
    setStatus('Starting Station Agent service...')
    const message = await invoke('ensure_station_agent')
    setStatus(message)
  } catch (error) {
    setStatus(`Station Agent launch failed: ${error}`)
    setBadge('Service failed')
    return
  }

  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const ready = await invoke('station_agent_status')
      if (ready) {
        await loadStationConfig()
        return
      }
    } catch {
      try {
        const response = await fetch(`${dashboardUrl}/status`, { cache: 'no-store' })
        if (response.ok) {
          await loadStationConfig()
          return
        }
      } catch {
        // The Python service is still starting.
      }
    }

    setStatus(`Starting Station Agent... ${attempt + 1}/120`)
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  setStatus('Station Agent did not respond. Check Windows security/firewall or whether port 8790 is already in use.')
  setBadge('Service offline')
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
  if (!invoke) {
    setStatus('Station Agent desktop API did not load, so the app cannot run the installer from inside Windows.')
    return
  }

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

setupFormEl?.addEventListener('submit', async (event) => {
  event.preventDefault()
  const stationToken = String(stationTokenEl?.value || '').trim()
  if (!stationToken) {
    setStatus('Paste the station token for this device first.')
    stationTokenEl?.focus()
    return
  }

  saveSetupEl.disabled = true
  saveSetupEl.textContent = 'Connecting...'
  setStatus('Saving station token...')

  try {
    const response = await fetch(`${dashboardUrl}/desktop/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        station_name: String(stationNameEl?.value || '').trim(),
        station_token: stationToken,
        app_url: String(appUrlEl?.value || '').trim() || 'https://loopbase.io',
      }),
    })
    const config = await response.json()
    if (!response.ok || !config?.ok) {
      throw new Error(config?.message || 'Could not save station token.')
    }
    if (stationTokenEl) stationTokenEl.value = ''
    renderStationConfig(config)
  } catch (error) {
    setStatus(`Station connection failed: ${error}`)
  } finally {
    saveSetupEl.disabled = false
    saveSetupEl.textContent = 'Connect Station'
  }
})

waitForAgent()
checkForUpdates()
