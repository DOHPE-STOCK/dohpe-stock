const CURRENT_VERSION = '0.3.19'
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
const printerFormEl = document.querySelector('#printerForm')
const printerEnabledEl = document.querySelector('#printerEnabled')
const printerPollEnabledEl = document.querySelector('#printerPollEnabled')
const printerModeEl = document.querySelector('#printerMode')
const defaultPrinterEl = document.querySelector('#defaultPrinter')
const printerNetworkHostEl = document.querySelector('#printerNetworkHost')
const printerNetworkPortEl = document.querySelector('#printerNetworkPort')
const allowedPrintersEl = document.querySelector('#allowedPrinters')
const refreshPrintersEl = document.querySelector('#refreshPrinters')
const photoFormEl = document.querySelector('#photoForm')
const photoEnabledEl = document.querySelector('#photoEnabled')
const photoSourcesEl = document.querySelector('#photoSources')
const configStationNameEl = document.querySelector('#configStationName')
const configAppUrlEl = document.querySelector('#configAppUrl')

let availableUpdate = null
let statusFadeTimer = null
let buildNumberResetTimer = null
let currentStationConfig = null
let currentPrinterConfig = null
let currentPhotoConfig = null

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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
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
    void loadPrinterConfig()
  }
  if (section === 'photography') {
    void loadPhotoConfig()
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

function renderPrinterConfig(data) {
  currentPrinterConfig = data
  const printer = data?.printer || {}
  const printers = Array.isArray(data?.printers) ? data.printers : []
  if (printerCountEl) printerCountEl.textContent = `${printers.length} printer${printers.length === 1 ? '' : 's'} found`
  if (printerEnabledEl) printerEnabledEl.checked = Boolean(printer.remote_enabled ?? printer.enabled)
  if (printerPollEnabledEl) printerPollEnabledEl.checked = Boolean(printer.remote_poll_enabled)
  if (printerModeEl) printerModeEl.value = printer.mode || 'windows'
  if (printerNetworkHostEl) printerNetworkHostEl.value = printer.network_host || ''
  if (printerNetworkPortEl) printerNetworkPortEl.value = String(printer.network_port || 9100)

  if (defaultPrinterEl) {
    defaultPrinterEl.innerHTML = '<option value="">Choose printer</option>'
    printers.forEach((row) => {
      const option = document.createElement('option')
      option.value = row.name || ''
      option.textContent = `${row.name || 'Unnamed printer'}${row.default ? ' (default)' : ''}`
      option.selected = row.name === printer.windows_printer_name
      defaultPrinterEl.appendChild(option)
    })
  }

  if (allowedPrintersEl) {
    const allowed = new Set(Array.isArray(printer.allowed_printers) ? printer.allowed_printers : [])
    allowedPrintersEl.innerHTML = printers.length
      ? printers.map((row, index) => {
        const checked = !allowed.size || allowed.has(row.name) ? 'checked' : ''
        return `
          <label class="choice-row">
            <span>${escapeHtml(row.name)}${row.default ? ' <small class="muted">Default</small>' : ''}</span>
            <input type="checkbox" data-allowed-printer="${index}" value="${escapeHtml(row.name)}" ${checked}>
          </label>
        `
      }).join('')
      : '<p class="muted">No Windows printers detected on this PC yet.</p>'
  }
}

async function loadPrinterConfig() {
  try {
    const response = await fetch(`${dashboardUrl}/api/printer/config`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok || !data?.ok) throw new Error(data?.message || 'Could not load printers')
    renderPrinterConfig(data)
  } catch (error) {
    if (printerCountEl) printerCountEl.textContent = 'Could not load printers'
    setStatus(`Printer settings failed to load: ${error}`)
  }
}

function renderPhotoConfig(data) {
  currentPhotoConfig = data
  const photo = data?.photo || {}
  const sources = Array.isArray(data?.sources) ? data.sources.slice(0, 3) : []
  while (sources.length < 3) {
    sources.push({ name: `Photo Source ${sources.length + 1}`, token: '', watch_folder: '', processed_folder: '', trash_folder: '' })
  }
  if (photoEnabledEl) photoEnabledEl.checked = Boolean(photo.enabled)
  if (photoSourcesEl) {
    photoSourcesEl.innerHTML = sources.map((source, index) => `
      <div class="source-card" data-source-index="${index}">
        <h3>Source ${index + 1}</h3>
        <div>
          <label>Source name<input data-photo-field="name" value="${escapeHtml(source.name || `Photo Source ${index + 1}`)}" placeholder="Camera import folder"></label>
        </div>
        <div class="path-row">
          <label>Watch folder<input data-photo-field="watch_folder" value="${escapeHtml(source.watch_folder || '')}" placeholder="C:\\Photography\\Station 1 or \\\\NAS\\Photos\\Station 1"></label>
          <button class="ghost-button compact" type="button" data-browse-source="${index}">Browse</button>
        </div>
        <div class="form-grid">
          <label>Processed folder<input data-photo-field="processed_folder" value="${escapeHtml(source.processed_folder || '')}" placeholder="Optional"></label>
          <label>Trash folder<input data-photo-field="trash_folder" value="${escapeHtml(source.trash_folder || '')}" placeholder="Optional"></label>
        </div>
      </div>
    `).join('')
  }
}

async function loadPhotoConfig() {
  try {
    const response = await fetch(`${dashboardUrl}/api/photo/config`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok || !data?.ok) throw new Error(data?.message || 'Could not load photography settings')
    renderPhotoConfig(data)
  } catch (error) {
    setStatus(`Photography settings failed to load: ${error}`)
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

refreshPrintersEl?.addEventListener('click', () => {
  void loadPrinterConfig()
})

printerFormEl?.addEventListener('submit', async (event) => {
  event.preventDefault()
  const allowedPrinters = [...document.querySelectorAll('[data-allowed-printer]')]
    .filter((input) => input.checked)
    .map((input) => input.value)
    .filter(Boolean)
  setStatus('Saving printer settings...')
  try {
    const response = await fetch(`${dashboardUrl}/api/printer/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        enabled: true,
        remote_enabled: Boolean(printerEnabledEl?.checked),
        remote_poll_enabled: Boolean(printerPollEnabledEl?.checked),
        mode: printerModeEl?.value || 'windows',
        windows_printer_name: defaultPrinterEl?.value || '',
        allowed_printers: allowedPrinters,
        network_host: printerNetworkHostEl?.value || '',
        network_port: printerNetworkPortEl?.value || '9100',
      }),
    })
    const data = await response.json()
    if (!response.ok || !data?.ok) throw new Error(data?.message || 'Could not save printers')
    renderPrinterConfig(data)
    await loadStationConfig()
    setStatus('Printer settings saved.')
    fadeStatusSoon()
  } catch (error) {
    setStatus(`Printer settings failed to save: ${error}`)
  }
})

photoSourcesEl?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-browse-source]')
  if (!button) return
  if (!invoke) {
    setStatus('Folder selector is only available in the Windows desktop app.')
    return
  }
  const index = Number.parseInt(button.dataset.browseSource, 10)
  try {
    const selected = await invoke('select_windows_folder', {
      title: `Choose watch folder for Photo Source ${index + 1}`,
    })
    const card = button.closest('[data-source-index]')
    const input = card?.querySelector('[data-photo-field="watch_folder"]')
    if (input) input.value = selected
  } catch (error) {
    setStatus(`Folder selection cancelled or failed: ${error}`)
  }
})

photoFormEl?.addEventListener('submit', async (event) => {
  event.preventDefault()
  const sources = [...document.querySelectorAll('[data-source-index]')].map((card) => {
    const row = {}
    card.querySelectorAll('[data-photo-field]').forEach((input) => {
      row[input.dataset.photoField] = input.value || ''
    })
    return row
  })
  setStatus('Saving photography settings...')
  try {
    const response = await fetch(`${dashboardUrl}/api/photo/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        enabled: Boolean(photoEnabledEl?.checked),
        sources,
      }),
    })
    const data = await response.json()
    if (!response.ok || !data?.ok) throw new Error(data?.message || 'Could not save photography settings')
    renderPhotoConfig(data)
    setStatus('Photography settings saved.')
    fadeStatusSoon()
  } catch (error) {
    setStatus(`Photography settings failed to save: ${error}`)
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

moduleCards.forEach((card) => {
  card.addEventListener('click', () => openSection(card.dataset.section))
})

backToModulesEl?.addEventListener('click', closeSection)
waitForAgent()
checkForUpdates()
