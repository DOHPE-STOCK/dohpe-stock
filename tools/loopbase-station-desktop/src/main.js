const CURRENT_VERSION = '0.3.17'
const dashboardUrl = 'http://127.0.0.1:8790'
const invoke = window.__TAURI__?.core?.invoke

const statusEl = document.querySelector('#status')
const headerUpdateNowEl = document.querySelector('#headerUpdateNow')
const buildNumberEl = document.querySelector('#buildNumber')
const connectionBadgeEl = document.querySelector('#connectionBadge')
const setupPanelEl = document.querySelector('#setupPanel')
const setupFormEl = document.querySelector('#setupForm')
const stationNameEl = document.querySelector('#stationName')
const stationTokenEl = document.querySelector('#stationToken')
const appUrlEl = document.querySelector('#appUrl')
const moduleGridEl = document.querySelector('#moduleGrid')
const saveSetupEl = document.querySelector('#saveSetup')
const moduleViewEl = document.querySelector('#moduleView')
const backToModulesEl = document.querySelector('#backToModules')
const sectionEyebrowEl = document.querySelector('#sectionEyebrow')
const sectionTitleEl = document.querySelector('#sectionTitle')
const moduleCards = [...document.querySelectorAll('[data-section]')]
const sectionPanels = [...document.querySelectorAll('[data-panel]')]
const printerCountEl = document.querySelector('#printerCount')
const remotePrintStateEl = document.querySelector('#remotePrintState')
const configStationNameEl = document.querySelector('#configStationName')
const configAppUrlEl = document.querySelector('#configAppUrl')

let availableUpdate = null
let statusFadeTimer = null
let buildNumberResetTimer = null
let currentStationConfig = null

const sections = {
  printer: { eyebrow: 'Print', title: 'Remote Printer' },
  photography: { eyebrow: 'Photo', title: 'Photography Stations' },
  rfid: { eyebrow: 'RFID', title: 'RFID Reader / Writer' },
  zones: { eyebrow: 'Zone', title: 'RFID Zone Monitor' },
  config: { eyebrow: 'Config', title: 'Station Config' },
}

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

function resetBuildNumberLabel(delay = 0) {
  if (!buildNumberEl) return
  clearTimeout(buildNumberResetTimer)
  const reset = () => {
    buildNumberEl.disabled = false
    buildNumberEl.textContent = `Build ${CURRENT_VERSION}`
    buildNumberEl.classList.remove('checking', 'success', 'failed')
  }
  if (delay > 0) {
    buildNumberResetTimer = setTimeout(reset, delay)
    return
  }
  reset()
}

function setBuildNumberNotice(message, className = '', resetDelay = 0) {
  if (!buildNumberEl) return
  clearTimeout(buildNumberResetTimer)
  buildNumberEl.disabled = false
  buildNumberEl.textContent = message
  buildNumberEl.classList.remove('checking', 'success', 'failed')
  if (className) buildNumberEl.classList.add(className)
  if (resetDelay > 0) resetBuildNumberLabel(resetDelay)
}

function setBadge(message, className = '') {
  if (!connectionBadgeEl) return
  connectionBadgeEl.textContent = message
  connectionBadgeEl.className = `connection-badge ${className}`.trim()
}

function renderStationConfig(config) {
  currentStationConfig = config
  if (appUrlEl && config?.app_url) appUrlEl.value = config.app_url
  if (stationNameEl) {
    stationNameEl.value = config?.connected && config?.station_name ? config.station_name : ''
  }

  if (config?.connected) {
    setBadge(config.display_station_name || config.station_name || 'Station connected', 'connected')
    setupPanelEl?.classList.add('hidden')
    moduleGridEl?.classList.remove('hidden')
    setStatus('Station connected.')
    renderSectionData(config)
    fadeStatusSoon()
    return
  }

  setBadge('Token required', 'needs-token')
  moduleGridEl?.classList.add('hidden')
  setupPanelEl?.classList.remove('hidden')
  setStatus('Enter the station token for this device to connect Loopbase services.')
}

function renderSectionData(config = currentStationConfig) {
  if (!config) return
  resetBuildNumberLabel()
  if (configStationNameEl) configStationNameEl.textContent = config.display_station_name || config.station_name || 'Unnamed station'
  if (configAppUrlEl) configAppUrlEl.textContent = config.app_url || 'https://loopbase.io'
  if (remotePrintStateEl) remotePrintStateEl.textContent = config.remote_print_enabled ? 'Enabled' : 'Not enabled'
}

function openSection(section) {
  const meta = sections[section]
  if (!meta) return
  sectionEyebrowEl.textContent = meta.eyebrow
  sectionTitleEl.textContent = meta.title
  sectionPanels.forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.panel !== section)
  })
  moduleGridEl?.classList.add('hidden')
  moduleViewEl?.classList.remove('hidden')
  renderSectionData()
  if (section === 'printer') {
    void loadPrinterSummary()
  }
}

function closeSection() {
  moduleViewEl?.classList.add('hidden')
  moduleGridEl?.classList.remove('hidden')
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

async function checkForUpdates(showStatus = false) {
  resetBuildNumberLabel()
  if (showStatus) {
    setBuildNumberNotice('Checking...', 'checking')
  }
  try {
    const response = await fetch(`${dashboardUrl}/api/update/check`, { cache: 'no-store' })
    if (!response.ok) throw new Error('Update service unavailable')
    const manifest = await response.json()
    if (manifest?.ok === false) throw new Error(manifest?.message || 'Update check failed')
    const latestVersion = manifest?.version
    const downloadUrl = manifest?.download_url
    if (!latestVersion || !downloadUrl || compareVersions(latestVersion, CURRENT_VERSION) <= 0) {
      availableUpdate = null
      headerUpdateNowEl?.classList.add('hidden')
      if (buildNumberEl) buildNumberEl.classList.remove('hidden')
      if (showStatus) {
        setBuildNumberNotice('Up to date', 'success', 2000)
      }
      return
    }

    availableUpdate = manifest
    if (headerUpdateNowEl) headerUpdateNowEl.textContent = `Build ${latestVersion} available - Update now`
    headerUpdateNowEl?.classList.remove('hidden')
    buildNumberEl?.classList.add('hidden')
  } catch {
    headerUpdateNowEl?.classList.add('hidden')
    buildNumberEl?.classList.remove('hidden')
    if (showStatus) {
      setBuildNumberNotice('Check failed', 'failed', 2500)
    }
    // Update checks are non-blocking. The local station should still run.
  }
}

async function loadPrinterSummary() {
  try {
    const response = await fetch(`${dashboardUrl}/api/printers`, { cache: 'no-store' })
    const data = await response.json()
    const printers = Array.isArray(data?.printers) ? data.printers : []
    if (printerCountEl) printerCountEl.textContent = `${printers.length} printer${printers.length === 1 ? '' : 's'} found`
  } catch {
    if (printerCountEl) printerCountEl.textContent = 'Could not load printers'
  }
}

headerUpdateNowEl?.addEventListener('click', async () => {
  void installAvailableUpdate(headerUpdateNowEl)
})

buildNumberEl?.addEventListener('click', async () => {
  if (buildNumberEl.disabled) return
  buildNumberEl.disabled = true
  void checkForUpdates(true).finally(() => {
    if (!availableUpdate && buildNumberEl) buildNumberEl.disabled = false
  })
})

async function installAvailableUpdate(button) {
  if (!availableUpdate?.download_url) return
  if (!invoke) {
    setStatus('Station Agent desktop API did not load, so the app cannot run the installer from inside Windows.')
    return
  }

  const confirmed = window.confirm(
    `Update Loopbase Station Agent to ${availableUpdate.version}? This will download the installer, close this app, and start the installer. Saved station settings will be kept.`
  )
  if (!confirmed) return

  button.disabled = true
  button.textContent = 'Updating...'
  setStatus('Downloading Station Agent update...')

  try {
    const message = await invoke('install_station_agent_update', {
      downloadUrl: availableUpdate.download_url,
      version: availableUpdate.version || 'latest',
    })
    setStatus(message)
  } catch (error) {
    button.disabled = false
    button.textContent = 'Update Now'
    setStatus(`Update failed: ${error}`)
  }
}

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

moduleCards.forEach((card) => {
  card.addEventListener('click', () => openSection(card.dataset.section))
})

backToModulesEl?.addEventListener('click', closeSection)
waitForAgent()
checkForUpdates()
