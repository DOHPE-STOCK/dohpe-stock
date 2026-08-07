const CURRENT_VERSION = '0.3.14'
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
const moduleViewEl = document.querySelector('#moduleView')
const backToModulesEl = document.querySelector('#backToModules')
const sectionEyebrowEl = document.querySelector('#sectionEyebrow')
const sectionTitleEl = document.querySelector('#sectionTitle')
const moduleCards = [...document.querySelectorAll('[data-section]')]
const sectionPanels = [...document.querySelectorAll('[data-panel]')]
const checkUpdatesEl = document.querySelector('#checkUpdates')
const sectionUpdateNowEl = document.querySelector('#sectionUpdateNow')
const currentVersionEl = document.querySelector('#currentVersion')
const latestVersionEl = document.querySelector('#latestVersion')
const printerCountEl = document.querySelector('#printerCount')
const remotePrintStateEl = document.querySelector('#remotePrintState')
const configStationNameEl = document.querySelector('#configStationName')
const configAppUrlEl = document.querySelector('#configAppUrl')

let availableUpdate = null
let statusFadeTimer = null
let currentStationConfig = null

const sections = {
  printer: { eyebrow: 'Print', title: 'Remote Printer' },
  photography: { eyebrow: 'Photo', title: 'Photography Stations' },
  rfid: { eyebrow: 'RFID', title: 'RFID Reader / Writer' },
  zones: { eyebrow: 'Zone', title: 'RFID Zone Monitor' },
  config: { eyebrow: 'Config', title: 'Station Config' },
  updates: { eyebrow: 'Build', title: 'Updates' },
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
  if (currentVersionEl) currentVersionEl.textContent = CURRENT_VERSION
  if (latestVersionEl) latestVersionEl.textContent = availableUpdate?.version || config.update?.version || 'Not checked yet'
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
  updateBannerEl?.classList.add('hidden')
  renderSectionData()
  if (section === 'updates') {
    void checkForUpdates(true)
  }
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
  if (showStatus) {
    setStatus('Checking for Station Agent updates...')
    if (latestVersionEl) latestVersionEl.textContent = 'Checking...'
  }
  try {
    const response = await fetch(manifestUrl, { cache: 'no-store' })
    if (!response.ok) return
    const manifest = await response.json()
    const latestVersion = manifest?.version
    const downloadUrl = manifest?.download_url
    if (!latestVersion || !downloadUrl || compareVersions(latestVersion, CURRENT_VERSION) <= 0) {
      availableUpdate = null
      if (latestVersionEl) latestVersionEl.textContent = latestVersion || 'Up to date'
      if (sectionUpdateNowEl) sectionUpdateNowEl.disabled = true
      if (showStatus) {
        setStatus('Station Agent is up to date.')
        fadeStatusSoon()
      }
      return
    }

    availableUpdate = manifest
    updateTitleEl.textContent = `Loopbase Station Agent ${latestVersion} is ready`
    updateNotesEl.textContent = `Current version: ${CURRENT_VERSION}. This will download and install inside the Windows app. Saved station settings will be kept.`
    if (latestVersionEl) latestVersionEl.textContent = latestVersion
    if (sectionUpdateNowEl) sectionUpdateNowEl.disabled = false
    if (moduleViewEl?.classList.contains('hidden')) updateBannerEl?.classList.remove('hidden')
    if (showStatus) setStatus(`Loopbase Station Agent ${latestVersion} is ready.`)
  } catch {
    if (latestVersionEl) latestVersionEl.textContent = 'Check failed'
    if (showStatus) setStatus('Update check failed. Check your internet connection and Loopbase URL.')
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

updateNowEl?.addEventListener('click', async () => {
  void installAvailableUpdate(updateNowEl)
})

sectionUpdateNowEl?.addEventListener('click', async () => {
  void installAvailableUpdate(sectionUpdateNowEl)
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
checkUpdatesEl?.addEventListener('click', () => {
  void checkForUpdates(true)
})

waitForAgent()
checkForUpdates()
