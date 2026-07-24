'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'react-qr-code'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { useCompany } from '@/app/context/CompanyContext'
import { useStaff } from '@/app/context/StaffContext'
import { supabase } from '@/lib/supabase'

type PhotoStation = {
  id: string
  name: string
  code: string
  description?: string | null
  status?: string | null
  active_photo_session_id?: string | null
  auto_start_from_rfid?: boolean | null
  auto_start_from_barcode?: boolean | null
  active_session?: any
}

type ItemImage = {
  id: string
  item_id: string
  original_url: string | null
  processed_url: string | null
  image_order: number | null
  created_at?: string | null
}

type PhotoCapture = {
  id: string
  item_image_id: string | null
  session_id: string | null
  item_id?: string | null
  assignment_method: string | null
  capture_status: string | null
  original_filename: string | null
  received_at: string | null
  exif?: Record<string, any> | null
}

type CaptureRepresentation = {
  id: string
  capture_id: string
  representation_type: string
  status: string
  public_url?: string | null
  local_reference?: Record<string, any> | null
  original_filename?: string | null
  file_size_bytes?: number | null
  metadata?: Record<string, any> | null
}

type PhotoSource = {
  id: string
  station_id: string
  name: string
  source_type: string
  enabled: boolean
  source_file_policy?: string | null
  token_last_four: string | null
  token_created_at: string | null
  token_revoked_at: string | null
  last_activity_at: string | null
}

type CalibrationProfile = {
  id: string
  name: string
  profile_type: string
  status: string
  source_id?: string | null
  profile_version?: number | null
  manufacturer?: string | null
  camera_model?: string | null
  lens_model?: string | null
  measured_reference?: Record<string, any> | null
  calibration_data?: Record<string, any> | null
  source?: any
}

type PhotoProcessingJob = {
  id: string
  capture_id: string
  session_id?: string | null
  job_type: string
  status: string
  processing_source: string
  calibration_profile_ids?: string[] | null
  error_message?: string | null
  queued_at?: string | null
  started_at?: string | null
  completed_at?: string | null
  result_representation_id?: string | null
  result_representation?: any
}

type PhotoViewMode = 'original' | 'calibrated' | 'processed' | 'background'

type ToggleSwitchProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label: string
}

type PhotoSessionHistory = {
  id: string
  item_id: string
  status: string | null
  measurement_source_capture_id?: string | null
  measurement_status?: string | null
  qc_status?: string | null
  qc_notes?: string | null
  completed_at?: string | null
  start_method: string | null
  started_at: string | null
  ended_at: string | null
  item?: any
}

function imageUrl(image: ItemImage | null) {
  return image?.processed_url || image?.original_url || ''
}

function itemTitle(item: any) {
  return item?.final_title || item?.ai_title || item?.basic_title || item?.website_title || item?.brand || 'Active item'
}

function formatShortDateTime(value: string | null | undefined) {
  if (!value) return 'Never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Never'
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function reviewReturnLabel(item: any) {
  if (!item?.review_return_reason) return ''
  if (item.review_return_type === 'needs_reshoot') return 'Needs reshoot'
  if (item.review_return_type === 'needs_edit') return 'Needs edit'
  return 'Returned from review'
}

function photoRoleLabel(value: unknown) {
  const role = String(value || '').replace(/_/g, ' ').trim()
  if (!role || role === 'other') return ''
  return role.charAt(0).toUpperCase() + role.slice(1)
}

function processingJobLabel(value: string) {
  return value.replace(/_/g, ' ')
}

function profileTypeLabel(value: string) {
  const labels: Record<string, string> = {
    colour_white_balance: 'Colour / WB',
    calibrite_colour_checker: 'Calibrite Colour Checker',
    geometry_scale: 'Geometry / Scale',
    lens_geometry: 'Lens Geometry',
  }
  return labels[value] || value.replace(/_/g, ' ')
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function ToggleSwitch({ checked, onChange, disabled = false, label }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-14 shrink-0 rounded-full border p-0.5 transition ${
        checked
          ? 'border-emerald-500 bg-emerald-600'
          : 'border-zinc-600 bg-zinc-800'
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <span
        className={`block h-5 w-5 rounded-full bg-white shadow transition ${
          checked ? 'translate-x-7' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

function SettingsCogIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path
        fill="currentColor"
        d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a8 8 0 0 0-2.6-1.5L14 2h-4l-.4 2.5A8 8 0 0 0 7 6L4.6 5l-2 3.5 2 1.5A9 9 0 0 0 4.5 12c0 .5 0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a8 8 0 0 0 2.6 1.5L10 22h4l.4-2.5A8 8 0 0 0 17 18l2.4 1 2-3.5-2-1.5ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"
      />
    </svg>
  )
}

function cropGuidelineForItem(item: any) {
  const category = String(item?.category || '').toLowerCase()
  const subCategory = String(item?.sub_category || item?.sub_type || '').toLowerCase()

  if (category.includes('bag') || subCategory.includes('bag')) {
    return 'Bag guideline: keep handles, base, corners, strap hardware, and any visible flaws inside frame with even padding.'
  }
  if (category.includes('shoe') || subCategory.includes('shoe') || subCategory.includes('trainer')) {
    return 'Footwear guideline: keep both shoes fully visible with sole, toe, heel, and side profile clear.'
  }
  if (category.includes('accessor') || subCategory.includes('belt') || subCategory.includes('hat')) {
    return 'Accessory guideline: keep the full object, labels, fastenings, and scale reference inside frame.'
  }
  return 'Clothing guideline: square item to the frame, keep cuffs/hem/collar inside frame, leave consistent edge padding, and avoid cropping labels or flaws.'
}

export default function PhotoMonitorPage() {
  const { activeCompanyId, activeCompany, schemaReady } = useCompany()
  const { staff } = useStaff()
  const [stations, setStations] = useState<PhotoStation[]>([])
  const [stationId, setStationId] = useState('')
  const [images, setImages] = useState<ItemImage[]>([])
  const [captures, setCaptures] = useState<PhotoCapture[]>([])
  const [representations, setRepresentations] = useState<CaptureRepresentation[]>([])
  const [processingJobs, setProcessingJobs] = useState<PhotoProcessingJob[]>([])
  const [unassignedCaptures, setUnassignedCaptures] = useState<PhotoCapture[]>([])
  const [sources, setSources] = useState<PhotoSource[]>([])
  const [calibrationProfiles, setCalibrationProfiles] = useState<CalibrationProfile[]>([])
  const [sessionHistory, setSessionHistory] = useState<PhotoSessionHistory[]>([])
  const [selectedImageId, setSelectedImageId] = useState('')
  const [batchSelectedImageIds, setBatchSelectedImageIds] = useState<string[]>([])
  const [batchRunCalibration, setBatchRunCalibration] = useState(true)
  const [batchRunBackgroundRemoval, setBatchRunBackgroundRemoval] = useState(false)
  const [batchRunAutoCropRotate, setBatchRunAutoCropRotate] = useState(false)
  const [autoMeasureOnComplete, setAutoMeasureOnComplete] = useState(false)
  const [completionWorkflowOpen, setCompletionWorkflowOpen] = useState(false)
  const [completionWorkflowStage, setCompletionWorkflowStage] = useState<'measure' | 'processing' | 'preview'>('processing')
  const [showStationSettings, setShowStationSettings] = useState(false)
  const [autoPreviewNewest, setAutoPreviewNewest] = useState(true)
  const [viewMode, setViewMode] = useState<PhotoViewMode>('original')
  const [showMeasurements, setShowMeasurements] = useState(false)
  const [processingSettingsOpen, setProcessingSettingsOpen] = useState<null | 'calibration' | 'crop_rotate' | 'background'>(null)
  const [aiComparisonOpen, setAiComparisonOpen] = useState(false)
  const [qcNotes, setQcNotes] = useState('')
  const [scanValue, setScanValue] = useState('')
  const [newStationName, setNewStationName] = useState('')
  const [editingStationName, setEditingStationName] = useState('')
  const [newSourceName, setNewSourceName] = useState('')
  const [newCalibrationName, setNewCalibrationName] = useState('')
  const [newCalibrationType, setNewCalibrationType] = useState('colour_white_balance')
  const [newCalibrationSourceId, setNewCalibrationSourceId] = useState('')
  const [newCalibrationBoardWidthMm, setNewCalibrationBoardWidthMm] = useState('')
  const [newCalibrationBoardHeightMm, setNewCalibrationBoardHeightMm] = useState('')
  const [newCalibrationMarkerSizeMm, setNewCalibrationMarkerSizeMm] = useState('')
  const [newCalibrationMarkerTopMm, setNewCalibrationMarkerTopMm] = useState('')
  const [newCalibrationMarkerRightMm, setNewCalibrationMarkerRightMm] = useState('')
  const [newCalibrationMarkerBottomMm, setNewCalibrationMarkerBottomMm] = useState('')
  const [newCalibrationMarkerLeftMm, setNewCalibrationMarkerLeftMm] = useState('')
  const [newCalibrationStartTrimPercent, setNewCalibrationStartTrimPercent] = useState('')
  const [newCalibrationEndTrimPercent, setNewCalibrationEndTrimPercent] = useState('')
  const [newCalibrationChart, setNewCalibrationChart] = useState('calibrite_colorchecker_classic')
  const [showArucoLayoutModal, setShowArucoLayoutModal] = useState(false)
  const [newSourceToken, setNewSourceToken] = useState('')
  const [newSourceSetupUrl, setNewSourceSetupUrl] = useState('')
  const [phonePairUrl, setPhonePairUrl] = useState('')
  const [phonePairExpiresAt, setPhonePairExpiresAt] = useState('')
  const [phonePairHoverExpanded, setPhonePairHoverExpanded] = useState(false)
  const [phonePairPinned, setPhonePairPinned] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const scanInputRef = useRef<HTMLInputElement | null>(null)
  const phonePairHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setStationId(params.get('station') || '')
  }, [])

  useEffect(() => {
    fetchStations()
  }, [activeCompanyId, schemaReady])

  const station = useMemo(
    () => stations.find((row) => row.id === stationId) || stations[0] || null,
    [stationId, stations]
  )

  const session = station?.active_session || null
  const item = Array.isArray(session?.item) ? session.item[0] : session?.item || null

  useEffect(() => {
    setEditingStationName(station?.name || '')
  }, [station?.id, station?.name])

  useEffect(() => {
    const timer = window.setTimeout(() => scanInputRef.current?.focus(), 100)
    return () => window.clearTimeout(timer)
  }, [station?.id, session?.id])

  useEffect(() => {
    if (!stationId && station?.id) {
      setStationId(station.id)
    }
  }, [station?.id, stationId])

  useEffect(() => {
    fetchImages()
    fetchCaptures()
    fetchUnassignedCaptures()
  }, [session?.item_id, activeCompanyId, schemaReady, station?.id])

  useEffect(() => {
    fetchSources()
    fetchCalibrationProfiles()
    fetchSessionHistory()
  }, [station?.id, activeCompanyId, schemaReady])

  useEffect(() => {
    fetchRepresentations()
    fetchProcessingJobs()
  }, [selectedImageId, captures, activeCompanyId])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return

      const target = event.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return
      if (images.length === 0) return

      event.preventDefault()
      const currentIndex = selectedImageId
        ? images.findIndex((image) => image.id === selectedImageId)
        : images.length - 1
      const fallbackIndex = currentIndex >= 0 ? currentIndex : images.length - 1
      const nextIndex =
        event.key === 'ArrowRight'
          ? Math.max(0, fallbackIndex - 1)
          : Math.min(images.length - 1, fallbackIndex + 1)
      setSelectedImageId(images[nextIndex]?.id || '')
      setAutoPreviewNewest(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [images, selectedImageId])

  useEffect(() => {
    if (!schemaReady || !activeCompanyId) return

    const channel = supabase
      .channel(`photo-monitor-${activeCompanyId}-${station?.id || 'none'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'photography_stations',
          filter: `company_id=eq.${activeCompanyId}`,
        },
        () => fetchStations(false)
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'photo_sessions',
          filter: `company_id=eq.${activeCompanyId}`,
        },
        () => fetchStations(false)
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeCompanyId, schemaReady, station?.id])

  useEffect(() => {
    if (!schemaReady || !activeCompanyId || !session?.item_id) return

    const channel = supabase
      .channel(`photo-monitor-images-${activeCompanyId}-${session.item_id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'item_images',
          filter: `item_id=eq.${session.item_id}`,
        },
        () => fetchImages(false)
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeCompanyId, schemaReady, session?.item_id])

  useEffect(() => {
    if (!schemaReady || !activeCompanyId || !session?.id) return

    const channel = supabase
      .channel(`photo-monitor-captures-${activeCompanyId}-${session.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'photo_captures',
          filter: `session_id=eq.${session.id}`,
        },
        () => fetchCaptures(false)
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeCompanyId, schemaReady, session?.id])

  useEffect(() => {
    if (!schemaReady || !activeCompanyId || !session?.id) return

    const channel = supabase
      .channel(`photo-monitor-processing-${activeCompanyId}-${session.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'photo_processing_jobs',
          filter: `session_id=eq.${session.id}`,
        },
        () => fetchProcessingJobs(false)
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeCompanyId, schemaReady, session?.id, selectedImageId])

  useEffect(() => {
    if (!schemaReady || !activeCompanyId || !station?.id) return

    const channel = supabase
      .channel(`photo-monitor-unassigned-${activeCompanyId}-${station.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'photo_captures',
          filter: `station_id=eq.${station.id}`,
        },
        () => fetchUnassignedCaptures(false)
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeCompanyId, schemaReady, station?.id])

  const selectedImage = useMemo(() => {
    if (selectedImageId) {
      return images.find((image) => image.id === selectedImageId) || images[0] || null
    }

    return images[0] || null
  }, [images, selectedImageId])
  const thumbnailImages = useMemo(() => [...images].reverse(), [images])

  async function fetchStations(showErrors = true) {
    try {
      const response = await fetch('/api/photography/stations')
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not load photography stations.')
      }

      const rows = (data.stations || []) as PhotoStation[]
      setStations(rows)

      if (!stationId && rows[0]?.id) {
        setStationId(rows[0].id)
      }
    } catch (error: any) {
      if (showErrors) setMessage(error.message || 'Could not load photography stations.')
    }
  }

  async function fetchImages(showErrors = true) {
    if (!session?.item_id) {
      setImages([])
      setSelectedImageId('')
      return
    }

    let query = supabase
      .from('item_images')
      .select('*')
      .eq('item_id', session.item_id)
      .order('image_order', { ascending: true })

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data, error } = await query

    if (error) {
      if (showErrors) setMessage(error.message)
      return
    }

    const nextImages = (data || []) as ItemImage[]
    setImages(nextImages)

    if (autoPreviewNewest && nextImages.length > 0) {
      setSelectedImageId(nextImages[nextImages.length - 1].id)
    } else if (selectedImageId && !nextImages.some((image) => image.id === selectedImageId)) {
      setSelectedImageId(nextImages[0]?.id || '')
    } else if (!selectedImageId) {
      setSelectedImageId(nextImages[0]?.id || '')
    }
  }

  async function fetchCaptures(showErrors = true) {
    if (!session?.id) {
      setCaptures([])
      return
    }

    let query = supabase
      .from('photo_captures')
      .select('id, item_image_id, item_id, session_id, assignment_method, capture_status, original_filename, received_at, exif')
      .eq('session_id', session.id)
      .order('received_at', { ascending: true })

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data, error } = await query

    if (error) {
      if (showErrors) setMessage(error.message)
      return
    }

    setCaptures((data || []) as PhotoCapture[])
  }

  async function fetchUnassignedCaptures(showErrors = true) {
    if (!station?.id) {
      setUnassignedCaptures([])
      return
    }

    let query = supabase
      .from('photo_captures')
      .select('id, item_image_id, item_id, session_id, assignment_method, capture_status, original_filename, received_at, exif')
      .eq('station_id', station.id)
      .eq('capture_status', 'unassigned')
      .order('received_at', { ascending: false })
      .limit(12)

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data, error } = await query

    if (error) {
      if (showErrors) setMessage(error.message)
      return
    }

    setUnassignedCaptures((data || []) as PhotoCapture[])
  }

  async function fetchSources(showErrors = true) {
    if (!station?.id) {
      setSources([])
      return
    }

    try {
      const response = await fetch(`/api/photography/sources?station_id=${encodeURIComponent(station.id)}`)
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not load photo sources.')
      }

      setSources((data.sources || []) as PhotoSource[])
    } catch (error: any) {
      if (showErrors) setMessage(error.message || 'Could not load photo sources.')
    }
  }

  async function fetchRepresentations(showErrors = true) {
    const linkedCapture = selectedImageId ? captureByImageId.get(selectedImageId) : null
    if (!linkedCapture?.id) {
      setRepresentations([])
      return
    }

    try {
      const response = await fetch(
        `/api/photography/captures/representations?capture_id=${encodeURIComponent(linkedCapture.id)}`
      )
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not load capture representations.')
      }

      setRepresentations(data.representations || [])
    } catch (error: any) {
      if (showErrors) setMessage(error.message || 'Could not load capture representations.')
    }
  }

  async function fetchProcessingJobs(showErrors = true) {
    const linkedCapture = selectedImageId ? captureByImageId.get(selectedImageId) : null
    if (!linkedCapture?.id) {
      setProcessingJobs([])
      return
    }

    try {
      const response = await fetch(
        `/api/photography/processing-jobs?capture_id=${encodeURIComponent(linkedCapture.id)}`
      )
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not load processing jobs.')
      }

      setProcessingJobs(data.jobs || [])
    } catch (error: any) {
      if (showErrors) setMessage(error.message || 'Could not load processing jobs.')
    }
  }

  async function fetchCalibrationProfiles(showErrors = true) {
    if (!station?.id) {
      setCalibrationProfiles([])
      return
    }

    try {
      const response = await fetch(
        `/api/photography/calibration-profiles?station_id=${encodeURIComponent(station.id)}`
      )
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not load calibration profiles.')
      }

      setCalibrationProfiles(data.profiles || [])
    } catch (error: any) {
      if (showErrors) setMessage(error.message || 'Could not load calibration profiles.')
    }
  }

  async function fetchSessionHistory(showErrors = true) {
    if (!station?.id) {
      setSessionHistory([])
      return
    }

    let query = supabase
      .from('photo_sessions')
      .select(
        `id, item_id, status, qc_status, qc_notes, completed_at, start_method,
        measurement_source_capture_id, measurement_status,
        started_at, ended_at,
        item:items(id, sku, final_title, ai_title, basic_title, website_title, brand)`
      )
      .eq('station_id', station.id)
      .order('started_at', { ascending: false })
      .limit(8)

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data, error } = await query

    if (error) {
      if (showErrors) setMessage(error.message)
      return
    }

    setSessionHistory((data || []) as PhotoSessionHistory[])
  }

  async function createPhotoSource() {
    const name = newSourceName.trim()
    if (!station?.id || !name) return

    setBusy(true)
    setMessage('')
    setNewSourceToken('')
    setNewSourceSetupUrl('')

    try {
      const response = await fetch('/api/photography/sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          station_id: station.id,
          name,
          source_type: 'watched_folder',
          issue_token: true,
        }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not create photo source.')
      }

      setNewSourceName('')
      setNewSourceToken(data.token || '')
      setNewSourceSetupUrl(makeWorkerSetupUrl(name, data.token || ''))
      await fetchSources(false)
      setMessage('Photo source created. Store the source token now.')
    } catch (error: any) {
      setMessage(error.message || 'Could not create photo source.')
    } finally {
      setBusy(false)
    }
  }

  async function updatePhotoSource(source: PhotoSource, patch: Record<string, any>) {
    setBusy(true)
    setMessage('')
    setNewSourceToken('')
    setNewSourceSetupUrl('')

    try {
      const response = await fetch('/api/photography/sources', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: source.id,
          ...patch,
        }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not update photo source.')
      }

      if (data.token) setNewSourceToken(data.token)
      if (data.token) setNewSourceSetupUrl(makeWorkerSetupUrl(source.name, data.token))
      await fetchSources(false)
      setMessage(data.token ? 'Photo source token rotated. Store the new token now.' : 'Photo source updated.')
    } catch (error: any) {
      setMessage(error.message || 'Could not update photo source.')
    } finally {
      setBusy(false)
    }
  }

  async function createCalibrationProfile() {
    if (!station?.id || !newCalibrationName.trim()) return

    setBusy(true)
    setMessage('')

    try {
      const measuredReference = {
        calibration_capture_id: selectedCapture?.id || null,
        board_width_mm: numberOrNull(newCalibrationBoardWidthMm),
        board_height_mm: numberOrNull(newCalibrationBoardHeightMm),
        aruco_marker_size_mm: numberOrNull(newCalibrationMarkerSizeMm),
        aruco_marker_distances_mm: {
          top_left_to_top_right: numberOrNull(newCalibrationMarkerTopMm),
          top_right_to_bottom_right: numberOrNull(newCalibrationMarkerRightMm),
          bottom_left_to_bottom_right: numberOrNull(newCalibrationMarkerBottomMm),
          top_left_to_bottom_left: numberOrNull(newCalibrationMarkerLeftMm),
        },
        calibrite_chart: newCalibrationType === 'calibrite_colour_checker' ? newCalibrationChart : null,
      }
      const calibrationData = {
        measurement_start_trim_percent: numberOrNull(newCalibrationStartTrimPercent),
        measurement_end_trim_percent: numberOrNull(newCalibrationEndTrimPercent),
        notes:
          'Stored calibration inputs only. Image processor must generate transforms before calibrated previews or measurements use them.',
      }
      const response = await fetch('/api/photography/calibration-profiles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          station_id: station.id,
          source_id: newCalibrationSourceId || null,
          name: newCalibrationName.trim(),
          profile_type: newCalibrationType,
          measured_reference: measuredReference,
          calibration_data: calibrationData,
        }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not create calibration profile.')
      }

      setNewCalibrationName('')
      setNewCalibrationBoardWidthMm('')
      setNewCalibrationBoardHeightMm('')
      setNewCalibrationMarkerSizeMm('')
      setNewCalibrationMarkerTopMm('')
      setNewCalibrationMarkerRightMm('')
      setNewCalibrationMarkerBottomMm('')
      setNewCalibrationMarkerLeftMm('')
      setNewCalibrationStartTrimPercent('')
      setNewCalibrationEndTrimPercent('')
      setShowArucoLayoutModal(false)
      await fetchCalibrationProfiles(false)
      setMessage('Calibration profile created.')
    } catch (error: any) {
      setMessage(error.message || 'Could not create calibration profile.')
    } finally {
      setBusy(false)
    }
  }

  async function updateCalibrationProfile(profile: CalibrationProfile, updates: Record<string, unknown>) {
    setBusy(true)
    setMessage('')

    try {
      const response = await fetch('/api/photography/calibration-profiles', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: profile.id, ...updates }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not update calibration profile.')
      }

      await fetchCalibrationProfiles(false)
      setMessage('Calibration profile updated.')
    } catch (error: any) {
      setMessage(error.message || 'Could not update calibration profile.')
    } finally {
      setBusy(false)
    }
  }

  async function queueProcessingJob(
    jobType: 'calibrated_preview' | 'measurement_analysis' | 'background_removal' | 'processed_preview' | 'raw_development'
  ) {
    const linkedCapture = selectedImageId ? captureByImageId.get(selectedImageId) : null
    if (!linkedCapture?.id) {
      setMessage('Select a session photo before queueing processing.')
      return
    }

    setBusy(true)
    setMessage('')

    try {
      const response = await fetch('/api/photography/processing-jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          capture_id: linkedCapture.id,
          job_type: jobType,
          processing_source: 'jpeg_camera_original',
          calibration_profile_ids: calibrationProfiles
            .filter((profile) => profile.status === 'active')
            .map((profile) => profile.id),
        }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not queue processing job.')
      }

      await fetchProcessingJobs(false)
      setMessage(data.already_queued ? data.message : `${processingJobLabel(jobType)} queued.`)
    } catch (error: any) {
      setMessage(error.message || 'Could not queue processing job.')
    } finally {
      setBusy(false)
    }
  }

  async function queueProcessingJobForCapture(
    captureId: string,
    jobType: 'calibrated_preview' | 'measurement_analysis' | 'background_removal' | 'processed_preview' | 'raw_development'
  ) {
    const response = await fetch('/api/photography/processing-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        capture_id: captureId,
        job_type: jobType,
        processing_source: 'jpeg_camera_original',
        calibration_profile_ids: calibrationProfiles
          .filter((profile) => profile.status === 'active')
          .map((profile) => profile.id),
        options: {
          requested_from: 'photo_monitor_batch_pipeline',
        },
      }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || !data?.ok) {
      throw new Error(data?.message || `Could not queue ${processingJobLabel(jobType)}.`)
    }
    return data
  }

  function batchTargetImageIds() {
    const chosen = batchSelectedImageIds.filter((id) => images.some((image) => image.id === id))
    return chosen.length > 0 ? chosen : images.map((image) => image.id)
  }

  function toggleBatchImage(imageId: string) {
    setBatchSelectedImageIds((current) =>
      current.includes(imageId) ? current.filter((id) => id !== imageId) : [...current, imageId]
    )
  }

  async function runBatchPreviewPipeline() {
    const targetImageIds = batchTargetImageIds()
    if (targetImageIds.length === 0) {
      setMessage('Add photos before running the batch pipeline.')
      return
    }
    if (!batchRunCalibration && !batchRunBackgroundRemoval && !batchRunAutoCropRotate) {
      setMessage('Choose at least one batch processing step.')
      return
    }

    const targetCaptures = targetImageIds
      .map((id) => captureByImageId.get(id))
      .filter((capture): capture is PhotoCapture => Boolean(capture?.id))

    if (targetCaptures.length === 0) {
      setMessage('The selected photos are not linked to station captures yet.')
      return
    }

    setBusy(true)
    setMessage('')

    try {
      let queued = 0
      for (const capture of targetCaptures) {
        if (batchRunCalibration) {
          await queueProcessingJobForCapture(capture.id, 'calibrated_preview')
          queued += 1
        }
        if (batchRunAutoCropRotate) {
          await queueProcessingJobForCapture(capture.id, 'processed_preview')
          queued += 1
        }
        if (batchRunBackgroundRemoval) {
          await queueProcessingJobForCapture(capture.id, 'background_removal')
          queued += 1
        }
      }

      await fetchProcessingJobs(false)
      setMessage(`${queued} batch preview job${queued === 1 ? '' : 's'} queued. Review outputs, then accept or revert.`)
    } catch (error: any) {
      setMessage(error.message || 'Could not queue batch preview pipeline.')
    } finally {
      setBusy(false)
    }
  }

  async function acceptBatchPreviewPipeline() {
    const targetImageIds = batchTargetImageIds()
    const targetCaptures = targetImageIds
      .map((id) => captureByImageId.get(id))
      .filter((capture): capture is PhotoCapture => Boolean(capture?.id))

    if (targetCaptures.length === 0) {
      setMessage('There are no selected session captures to accept.')
      return
    }

    setBusy(true)
    setMessage('')

    try {
      const response = await fetch(
        `/api/photography/captures/representations?session_id=${encodeURIComponent(session?.id || '')}`
      )
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not load batch preview results.')
      }

      const representationsByCapture = new Map<string, CaptureRepresentation[]>()
      for (const representation of data.representations || []) {
        const rows = representationsByCapture.get(representation.capture_id) || []
        rows.push(representation)
        representationsByCapture.set(representation.capture_id, rows)
      }

      const preferredTypes = [
        batchRunBackgroundRemoval ? 'background_removed' : '',
        batchRunAutoCropRotate ? 'processed_preview' : '',
        batchRunCalibration ? 'calibrated_preview' : '',
        'background_removed',
        'processed_preview',
        'calibrated_preview',
      ].filter(Boolean)

      let applied = 0
      const missing: string[] = []

      for (const capture of targetCaptures) {
        const rows = representationsByCapture.get(capture.id) || []
        const representation = preferredTypes
          .map((type) => rows.find((row) => row.representation_type === type && row.status === 'available' && row.public_url))
          .find(Boolean)

        if (!representation) {
          missing.push(capture.original_filename || capture.id)
          continue
        }

        const applyResponse = await fetch('/api/photography/captures/representations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'apply_to_item_image',
            representation_id: representation.id,
          }),
        })
        const applyData = await applyResponse.json().catch(() => null)
        if (!applyResponse.ok || !applyData?.ok) {
          throw new Error(applyData?.message || 'Could not accept one of the processed images.')
        }
        applied += 1
      }

      await fetchImages(false)
      await fetchRepresentations(false)
      setMessage(
        missing.length
          ? `${applied} processed image${applied === 1 ? '' : 's'} accepted. ${missing.length} had no completed preview yet.`
          : `${applied} processed image${applied === 1 ? '' : 's'} accepted.`
      )
    } catch (error: any) {
      setMessage(error.message || 'Could not accept batch preview.')
    } finally {
      setBusy(false)
    }
  }

  function revertBatchPreviewPipeline() {
    setViewMode('original')
    setMessage('Batch preview reverted. Nothing was applied to the item images.')
  }

  async function cancelProcessingJob(job: PhotoProcessingJob) {
    setBusy(true)
    setMessage('')

    try {
      const response = await fetch('/api/photography/processing-jobs', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: job.id,
          status: 'cancelled',
        }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not cancel processing job.')
      }

      await fetchProcessingJobs(false)
      setMessage('Processing job cancelled.')
    } catch (error: any) {
      setMessage(error.message || 'Could not cancel processing job.')
    } finally {
      setBusy(false)
    }
  }

  async function cancelActiveSessionProcessingJobs() {
    if (!session?.id) {
      setMessage('Start a photo session before cancelling session jobs.')
      return
    }

    setBusy(true)
    setMessage('')

    try {
      const response = await fetch(
        `/api/photography/processing-jobs?session_id=${encodeURIComponent(session.id)}`
      )
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not load session processing jobs.')
      }

      const activeJobs = (data.jobs || []).filter((job: PhotoProcessingJob) =>
        ['queued', 'waiting_for_worker', 'processing', 'uploading'].includes(job.status)
      )

      if (activeJobs.length === 0) {
        setMessage('No active session processing jobs to cancel.')
        return
      }

      const results = await Promise.all(
        activeJobs.map((job: PhotoProcessingJob) =>
          fetch('/api/photography/processing-jobs', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: job.id,
              status: 'cancelled',
              error_message: 'Cancelled from Photo Monitor.',
            }),
          })
        )
      )

      const failed = results.filter((result) => !result.ok).length
      await fetchProcessingJobs(false)
      setMessage(
        failed
          ? `${activeJobs.length - failed} processing jobs cancelled, ${failed} failed.`
          : `${activeJobs.length} active processing jobs cancelled.`
      )
    } catch (error: any) {
      setMessage(error.message || 'Could not cancel session processing jobs.')
    } finally {
      setBusy(false)
    }
  }

  async function createStation() {
    const name = newStationName.trim()
    if (!name) return

    setBusy(true)
    setMessage('')

    try {
      const response = await fetch('/api/photography/stations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not create station.')
      }

      setNewStationName('')
      await fetchStations(false)
      if (data.station?.id) setStationId(data.station.id)
      setMessage('Photography station created.')
    } catch (error: any) {
      setMessage(error.message || 'Could not create station.')
    } finally {
      setBusy(false)
    }
  }

  async function renameStation() {
    const name = editingStationName.trim()
    if (!station?.id || !name || name === station.name) return

    setBusy(true)
    setMessage('')

    try {
      const response = await fetch('/api/photography/stations', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: station.id, name }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not rename station.')
      }

      await fetchStations(false)
      setMessage('Photography station renamed.')
    } catch (error: any) {
      setMessage(error.message || 'Could not rename station.')
    } finally {
      setBusy(false)
    }
  }

  async function archiveStation() {
    if (!station?.id) return

    const confirmed = window.confirm(`Archive ${station.name}?`)
    if (!confirmed) return

    setBusy(true)
    setMessage('')

    try {
      const response = await fetch('/api/photography/stations', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: station.id, action: 'archive' }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not archive station.')
      }

      setStationId('')
      await fetchStations(false)
      setMessage('Photography station archived.')
    } catch (error: any) {
      setMessage(error.message || 'Could not archive station.')
    } finally {
      setBusy(false)
    }
  }

  async function updateStationSettings(updates: Record<string, unknown>) {
    if (!station?.id) return

    setBusy(true)
    setMessage('')

    try {
      const response = await fetch('/api/photography/stations', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: station.id, ...updates }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not update station settings.')
      }

      await fetchStations(false)
      setMessage('Station settings updated.')
    } catch (error: any) {
      setMessage(error.message || 'Could not update station settings.')
    } finally {
      setBusy(false)
    }
  }

  async function createPhonePairing() {
    if (!station?.id) return ''

    setBusy(true)
    setMessage('')

    try {
      const response = await fetch('/api/photography/phone-pairing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          station_id: station.id,
          app_origin: window.location.origin,
        }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not create phone pairing QR.')
      }

      const nextPairUrl = String(data.pair_url || '').trim()
      if (!/^https?:\/\//i.test(nextPairUrl)) {
        throw new Error('Phone pairing QR did not return a valid web URL.')
      }

      setPhonePairUrl(nextPairUrl)
      setPhonePairExpiresAt(data.expires_at || '')
      setMessage('Phone pairing QR created.')
      return nextPairUrl
    } catch (error: any) {
      setMessage(error.message || 'Could not create phone pairing QR.')
      return ''
    } finally {
      setBusy(false)
    }
  }

  async function deleteSelectedImage(imageToDelete: ItemImage | null = selectedImage) {
    if (!imageToDelete) return

    const confirmed = window.confirm('Delete this photo from the item?')
    if (!confirmed) return

    setBusy(true)
    setMessage('')

    const linkedCapture = captureByImageId.get(imageToDelete.id)

    try {
      const response = await fetch('/api/photography/captures/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          item_image_id: imageToDelete.id,
          capture_id: linkedCapture?.id || null,
        }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not delete photo.')
      }

      setMessage(
        data.queued_command
          ? 'Photo deleted. Local source action queued for the worker.'
          : staff
            ? `Photo deleted by ${staff.name}.`
            : 'Photo deleted.'
      )
    } catch (error: any) {
      setMessage(error.message || 'Could not delete photo.')
      setBusy(false)
      return
    }

    if (selectedImageId === imageToDelete.id) setSelectedImageId('')
    await fetchImages(false)
    await fetchCaptures(false)
    setBusy(false)
  }

  async function applyViewedRepresentation() {
    const representation =
      viewMode === 'background'
        ? backgroundRepresentation
        : viewMode === 'processed'
          ? processedRepresentation
          : viewMode === 'calibrated'
            ? calibratedRepresentation
            : null

    if (!representation?.id || !representation.public_url) {
      setMessage('Select a generated processed view before applying it.')
      return
    }

    setBusy(true)
    setMessage('')

    try {
      const response = await fetch('/api/photography/captures/representations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'apply_to_item_image',
          representation_id: representation.id,
        }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not apply processed image.')
      }

      await fetchImages(false)
      setMessage('Processed version applied to the item image.')
    } catch (error: any) {
      setMessage(error.message || 'Could not apply processed image.')
    } finally {
      setBusy(false)
    }
  }

  async function endSession() {
    if (!station?.id) return

    const confirmed = window.confirm('End the active photo session on this station?')
    if (!confirmed) return

    setBusy(true)
    setMessage('')

    try {
      const response = await fetch('/api/photography/sessions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'end', station_id: station.id }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not end photo session.')
      }

      setImages([])
      setCaptures([])
      setUnassignedCaptures([])
      setSelectedImageId('')
      await fetchStations(false)
      await fetchSessionHistory(false)
      setMessage('Photo session ended.')
    } catch (error: any) {
      setMessage(error.message || 'Could not end photo session.')
    } finally {
      setBusy(false)
    }
  }

  async function completeSession(qcStatus = 'complete', skipConfirm = false) {
    if (!station?.id) return

    const label = qcStatus === 'needs_reshoot' ? 'mark this session as needing reshoot' : 'complete this photo session'
    const confirmed = skipConfirm || window.confirm(`Are you sure you want to ${label}?`)
    if (!confirmed) return

    setBusy(true)
    setMessage('')

    try {
      const response = await fetch('/api/photography/sessions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'complete',
          station_id: station.id,
          staff_id: staff?.id || null,
          qc_status: qcStatus,
          qc_notes: qcNotes,
        }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not complete photo session.')
      }

      setImages([])
      setCaptures([])
      setSelectedImageId('')
      setQcNotes('')
      await fetchStations(false)
      await fetchSessionHistory(false)
      setMessage(qcStatus === 'needs_reshoot' ? 'Photo session marked for reshoot.' : 'Photo session completed.')
    } catch (error: any) {
      setMessage(error.message || 'Could not complete photo session.')
    } finally {
      setBusy(false)
    }
  }

  function startCompletePhotosWorkflow() {
    if (!session?.id || images.length === 0) {
      setMessage('Take at least one photo before completing.')
      return
    }
    setCompletionWorkflowStage(autoMeasureOnComplete ? 'measure' : 'processing')
    setCompletionWorkflowOpen(true)
  }

  async function runCompletionProcessingPreview() {
    await runBatchPreviewPipeline()
    setCompletionWorkflowStage('preview')
  }

  async function acceptCompletionWorkflow() {
    await acceptBatchPreviewPipeline()
    setCompletionWorkflowOpen(false)
    await completeSession('complete', true)
  }

  function revertCompletionWorkflow() {
    revertBatchPreviewPipeline()
    setCompletionWorkflowOpen(false)
  }

  async function startSessionFromScan() {
    const clean = scanValue.trim()
    if (!clean || !station?.id) return

    setBusy(true)
    setMessage('')

    try {
      const response = await fetch('/api/photography/sessions/start-from-scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          station_id: station.id,
          scan_value: clean,
          staff_id: staff?.id || null,
        }),
      })

      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not start photo session from scan.')
      }

      setScanValue('')
      setQcNotes('')
      setImages([])
      setCaptures([])
      setSelectedImageId('')
      await fetchStations(false)
      await fetchUnassignedCaptures(false)
      await fetchSessionHistory(false)
      setMessage(`Photo session started for ${data.item?.sku || clean}.`)
      window.setTimeout(() => scanInputRef.current?.focus(), 50)
    } catch (error: any) {
      setMessage(error.message || 'Could not start photo session from scan.')
    } finally {
      setBusy(false)
    }
  }

  const currentUrl = imageUrl(selectedImage)
  const unassignedWithImages = useMemo(() => {
    return unassignedCaptures.filter((capture) => capture.exif?.public_url)
  }, [unassignedCaptures])
  const captureByImageId = useMemo(() => {
    return new Map(captures.filter((capture) => capture.item_image_id).map((capture) => [capture.item_image_id, capture]))
  }, [captures])
  const selectedCapture = selectedImageId ? captureByImageId.get(selectedImageId) || null : null
  const representationTypes = new Set(representations.map((row) => row.representation_type))
  const rawRepresentation = representations.find((row) => row.representation_type === 'raw_original')
  const calibratedRepresentation = representations.find((row) => row.representation_type === 'calibrated_preview')
  const processedRepresentation = representations.find((row) => row.representation_type === 'processed_preview')
  const backgroundRepresentation = representations.find((row) => row.representation_type === 'background_removed')
  const pipelineViewMode: PhotoViewMode =
    batchRunBackgroundRemoval && backgroundRepresentation?.public_url
      ? 'background'
      : batchRunAutoCropRotate && processedRepresentation?.public_url
        ? 'processed'
        : batchRunCalibration && calibratedRepresentation?.public_url
          ? 'calibrated'
          : 'original'
  const displayUrl =
    pipelineViewMode === 'background' && backgroundRepresentation?.public_url
      ? backgroundRepresentation.public_url
      : pipelineViewMode === 'processed' && processedRepresentation?.public_url
        ? processedRepresentation.public_url
        : pipelineViewMode === 'calibrated' && calibratedRepresentation?.public_url
          ? calibratedRepresentation.public_url
          : currentUrl
  const measurementSourceCaptureId = session?.measurement_source_capture_id || null
  const selectedIsMeasurementSource =
    Boolean(selectedCapture?.id && measurementSourceCaptureId && selectedCapture.id === measurementSourceCaptureId)
  const activeCalibrationCount = calibrationProfiles.filter((profile) => profile.status === 'active').length
  const activeProcessingJobs = processingJobs.filter((job) =>
    ['queued', 'waiting_for_worker', 'processing', 'uploading'].includes(job.status)
  )
  const latestCalibrationJob = processingJobs.find((job) => job.job_type === 'calibrated_preview')
  const latestMeasurementJob = processingJobs.find((job) => job.job_type === 'measurement_analysis')
  const latestBackgroundJob = processingJobs.find((job) => job.job_type === 'background_removal')
  const latestPreviewJob = processingJobs.find((job) => job.job_type === 'processed_preview')
  const latestRawJob = processingJobs.find((job) => job.job_type === 'raw_development')
  const viewedProcessedRepresentation =
    pipelineViewMode === 'background'
      ? backgroundRepresentation
      : pipelineViewMode === 'processed'
        ? processedRepresentation
        : pipelineViewMode === 'calibrated'
          ? calibratedRepresentation
          : null
  const phonePairExpanded = Boolean(phonePairUrl && (phonePairHoverExpanded || phonePairPinned))

  function makeWorkerSetupUrl(sourceName: string, token: string) {
    if (!token) return ''
    const params = new URLSearchParams({
      app_url: window.location.origin,
      source_name: sourceName,
      source_token: token,
    })
    return `http://127.0.0.1:8780/?${params.toString()}`
  }

  function closePhonePairQr() {
    if (phonePairHoverTimerRef.current) clearTimeout(phonePairHoverTimerRef.current)
    setPhonePairHoverExpanded(false)
    setPhonePairPinned(false)
  }

  async function assignCaptureToSession(capture: PhotoCapture) {
    if (!session?.id) {
      setMessage('Start a photo session before assigning a capture.')
      return
    }

    setBusy(true)
    setMessage('')

    try {
      const response = await fetch('/api/photography/captures/assign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          capture_id: capture.id,
          session_id: session.id,
        }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not assign capture.')
      }

      await fetchImages(false)
      await fetchCaptures(false)
      await fetchUnassignedCaptures(false)
      setMessage('Unassigned photo attached to the active session.')
    } catch (error: any) {
      setMessage(error.message || 'Could not assign capture.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <StaffPermissionGate permission="working">
      <main className="min-h-screen bg-zinc-950 p-4 text-white">
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-black p-4 shadow-2xl">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-green-300">
              {activeCompany?.name || 'Loopbase'} Photo Monitor
            </p>
            <h1 className="text-2xl font-black">
              {station?.name || 'No station selected'}
            </h1>
            <p className="text-sm font-bold text-zinc-300">
              {session?.status === 'active' && item
                ? `${item.sku} · ${itemTitle(item)}`
                : 'Waiting for a photo session'}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex min-w-[280px] items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 p-2">
              <input
                ref={scanInputRef}
                value={scanValue}
                onChange={(event) => setScanValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    startSessionFromScan()
                  }
                }}
                placeholder="Scan SKU, barcode, or RFID"
                className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-black px-3 text-sm font-bold text-white outline-none focus:border-white"
              />

              <button
                type="button"
                onClick={startSessionFromScan}
                disabled={busy || !scanValue.trim() || !station}
                className="h-9 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white disabled:opacity-50"
              >
                Start
              </button>
            </div>

            <select
              value={station?.id || ''}
              onChange={(event) => {
                setStationId(event.target.value)
                const params = new URLSearchParams(window.location.search)
                params.set('station', event.target.value)
                window.history.replaceState(null, '', `${window.location.pathname}?${params}`)
              }}
              className="h-10 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm font-bold text-white outline-none focus:border-white"
            >
              {stations.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setShowStationSettings(true)}
              disabled={!station}
              className="h-10 rounded-lg bg-zinc-800 px-4 text-sm font-black text-white disabled:opacity-50"
            >
              Station Settings
            </button>

            {item?.id && (
              <Link
                href={`/items/${item.id}`}
                className="h-10 rounded-lg bg-white px-4 py-2 text-sm font-black text-black"
              >
                Edit SKU
              </Link>
            )}

            <button
              type="button"
              onClick={startCompletePhotosWorkflow}
              disabled={busy || !session || images.length === 0}
              className="h-10 rounded-lg bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-50"
            >
              Complete Photos
            </button>
          </div>
        </header>

        {message && (
          <div className="mb-4 rounded-xl border border-yellow-700 bg-yellow-950 px-4 py-3 text-sm font-bold text-yellow-200">
            {message}
          </div>
        )}

        {item?.review_return_reason && (
          <div className="mb-4 rounded-xl border border-yellow-600 bg-yellow-950 px-4 py-3 text-sm font-bold text-yellow-100">
            <span className="font-black">{reviewReturnLabel(item)}:</span> {item.review_return_reason}
          </div>
        )}

        {showArucoLayoutModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <div className="w-full max-w-xl rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black">ArUco Marker Layout</h2>
                  <p className="mt-1 text-sm font-bold text-zinc-400">
                    Enter the measured distances between the four markers on this station board.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowArucoLayoutModal(false)}
                  className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white"
                >
                  Close
                </button>
              </div>

              <div className="relative mx-auto mb-4 aspect-[4/3] max-w-md rounded-xl border border-zinc-700 bg-black p-8">
                <div className="absolute left-8 top-8 h-9 w-9 rounded border-4 border-white bg-zinc-900" />
                <div className="absolute right-8 top-8 h-9 w-9 rounded border-4 border-white bg-zinc-900" />
                <div className="absolute bottom-8 left-8 h-9 w-9 rounded border-4 border-white bg-zinc-900" />
                <div className="absolute bottom-8 right-8 h-9 w-9 rounded border-4 border-white bg-zinc-900" />
                <div className="absolute left-[4.7rem] right-[4.7rem] top-[3.2rem] border-t-2 border-emerald-400" />
                <div className="absolute bottom-[3.2rem] left-[4.7rem] right-[4.7rem] border-t-2 border-emerald-400" />
                <div className="absolute bottom-[4.7rem] left-[3.2rem] top-[4.7rem] border-l-2 border-emerald-400" />
                <div className="absolute bottom-[4.7rem] right-[3.2rem] top-[4.7rem] border-l-2 border-emerald-400" />
                <span className="absolute left-1/2 top-3 -translate-x-1/2 text-xs font-black text-emerald-300">TL to TR</span>
                <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs font-black text-emerald-300">BL to BR</span>
                <span className="absolute left-3 top-1/2 -translate-y-1/2 -rotate-90 text-xs font-black text-emerald-300">TL to BL</span>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-xs font-black text-emerald-300">TR to BR</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  ['top_left_to_top_right', 'Top left to top right', newCalibrationMarkerTopMm, setNewCalibrationMarkerTopMm],
                  ['top_right_to_bottom_right', 'Top right to bottom right', newCalibrationMarkerRightMm, setNewCalibrationMarkerRightMm],
                  ['bottom_left_to_bottom_right', 'Bottom left to bottom right', newCalibrationMarkerBottomMm, setNewCalibrationMarkerBottomMm],
                  ['top_left_to_bottom_left', 'Top left to bottom left', newCalibrationMarkerLeftMm, setNewCalibrationMarkerLeftMm],
                ].map(([key, label, value, setter]) => (
                  <label key={key as string} className="block">
                    <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-zinc-500">
                      {label as string}
                    </span>
                    <input
                      value={value as string}
                      onChange={(event) => (setter as (next: string) => void)(event.target.value)}
                      placeholder="mm"
                      className="h-9 w-full rounded-lg border border-zinc-700 bg-black px-3 text-xs font-bold text-white outline-none focus:border-white"
                    />
                  </label>
                ))}
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setNewCalibrationMarkerTopMm('')
                    setNewCalibrationMarkerRightMm('')
                    setNewCalibrationMarkerBottomMm('')
                    setNewCalibrationMarkerLeftMm('')
                  }}
                  className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setShowArucoLayoutModal(false)}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {completionWorkflowOpen && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4">
            <div className="w-full max-w-3xl rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black">Complete Photos</h2>
                  <p className="mt-1 text-sm font-bold text-zinc-400">
                    Review measurements and processing before saving the final item images.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCompletionWorkflowOpen(false)}
                  className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white"
                >
                  Close
                </button>
              </div>

              {completionWorkflowStage === 'measure' && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-zinc-800 bg-black p-4">
                    <p className="text-sm font-black text-white">Measurement anchors</p>
                    <p className="mt-2 text-sm font-bold text-zinc-400">
                      Automatic anchor detection is not active yet. This stage is reserved for the adjustable anchor-point popup.
                      You can continue and edit measurements manually on the SKU page.
                    </p>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setCompletionWorkflowStage('processing')}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white"
                    >
                      Accept Measurements
                    </button>
                  </div>
                </div>
              )}

              {completionWorkflowStage === 'processing' && (
                <div className="space-y-4">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm font-black text-white">
                      <span>Apply active calibration</span>
                      <ToggleSwitch
                        checked={batchRunCalibration}
                        onChange={setBatchRunCalibration}
                        label="Apply active calibration"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm font-black text-white">
                      <span>Category crop / rotate</span>
                      <ToggleSwitch
                        checked={batchRunAutoCropRotate}
                        onChange={setBatchRunAutoCropRotate}
                        label="Category crop and rotate"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm font-black text-white">
                      <span>Background removal</span>
                      <ToggleSwitch
                        checked={batchRunBackgroundRemoval}
                        onChange={setBatchRunBackgroundRemoval}
                        label="Background removal"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm font-black text-white">
                      <span>Auto measure next time</span>
                      <ToggleSwitch
                        checked={autoMeasureOnComplete}
                        onChange={setAutoMeasureOnComplete}
                        label="Auto measure next time"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setCompletionWorkflowOpen(false)}
                      className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-black text-white"
                    >
                      Revert
                    </button>
                    <button
                      type="button"
                      onClick={runCompletionProcessingPreview}
                      disabled={busy}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
                    >
                      Run Preview
                    </button>
                  </div>
                </div>
              )}

              {completionWorkflowStage === 'preview' && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-zinc-800 bg-black p-4">
                    <p className="text-sm font-black text-white">Preview queued</p>
                    <p className="mt-2 text-sm font-bold text-zinc-400">
                      When the preview jobs complete, inspect the thumbnails and selected preview on the monitor.
                      Accept saves generated versions as the item images; revert leaves originals unchanged.
                    </p>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={revertCompletionWorkflow}
                      className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-black text-white"
                    >
                      Revert
                    </button>
                    <button
                      type="button"
                      onClick={acceptCompletionWorkflow}
                      disabled={busy}
                      className="rounded-lg bg-white px-4 py-2 text-sm font-black text-black disabled:opacity-40"
                    >
                      Accept & Complete
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {showStationSettings && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4">
            <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black">{station?.name || 'Station'} Settings</h2>
                  <p className="mt-1 text-sm font-bold text-zinc-400">
                    Sources, calibration, phone pairing and station defaults for this capture bench.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowStationSettings(false)}
                  className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white"
                >
                  Close
                </button>
              </div>

              <div className="grid gap-3">
                <div className="rounded-xl border border-zinc-800 bg-black p-4">
                  <h3 className="text-sm font-black text-white">Station</h3>
                  <p className="mt-1 text-xs font-bold text-zinc-400">
                    Rename this station, create another bench, or archive an unused station.
                  </p>

                  <div className="mt-3 space-y-2">
                    <div className="flex gap-2">
                      <input
                        value={editingStationName}
                        onChange={(event) => setEditingStationName(event.target.value)}
                        placeholder="Selected station name"
                        disabled={!station}
                        className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-bold text-white outline-none focus:border-white disabled:opacity-50"
                      />
                      <button
                        type="button"
                        onClick={renameStation}
                        disabled={busy || !station || !editingStationName.trim() || editingStationName.trim() === station.name}
                        className="h-9 rounded-lg bg-zinc-800 px-3 text-xs font-black text-white disabled:opacity-50"
                      >
                        Save
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <input
                        value={newStationName}
                        onChange={(event) => setNewStationName(event.target.value)}
                        placeholder="New station name"
                        className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-bold text-white outline-none focus:border-white"
                      />
                      <button
                        type="button"
                        onClick={createStation}
                        disabled={busy || !newStationName.trim()}
                        className="h-9 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={archiveStation}
                      disabled={busy || !station || Boolean(session)}
                      className="w-full rounded-lg border border-red-900 bg-red-950 px-3 py-2 text-xs font-black text-red-100 disabled:opacity-50"
                    >
                      Archive Selected Station
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-black p-4">
                  <h3 className="text-sm font-black text-white">Phone Capture</h3>
                  <p className="mt-1 text-xs font-bold text-zinc-400">
                    Optional. Uses the phone camera/file picker and uploads the original selected file without app-side compression.
                  </p>
                  <button
                    type="button"
                    onClick={createPhonePairing}
                    disabled={busy || !station}
                    className="mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                  >
                    Pair Phone
                  </button>
                  {phonePairUrl && (
                    <div className="mt-3 rounded-xl border border-zinc-800 bg-white p-3 text-black">
                      <div className="mx-auto w-fit">
                        <QRCode value={phonePairUrl} size={180} />
                      </div>
                      <p className="mt-3 break-all text-center text-[11px] font-bold text-zinc-700">{phonePairUrl}</p>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-zinc-800 bg-black p-4">
                  <h3 className="text-sm font-black text-white">Station Defaults</h3>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs font-black text-zinc-200">
                      <span>RFID auto-start</span>
                      <input
                        type="checkbox"
                        checked={station?.auto_start_from_rfid === true}
                        disabled={busy || !station}
                        onChange={(event) => updateStationSettings({ auto_start_from_rfid: event.target.checked })}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs font-black text-zinc-200">
                      <span>Barcode auto-start</span>
                      <input
                        type="checkbox"
                        checked={station?.auto_start_from_barcode === true}
                        disabled={busy || !station}
                        onChange={(event) => updateStationSettings({ auto_start_from_barcode: event.target.checked })}
                      />
                    </label>
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-black p-4">
                  <h3 className="text-sm font-black text-white">Sources</h3>
                  <p className="mt-1 text-xs font-bold text-zinc-400">
                    Add watched folders, phone sources, and worker tokens for this station.
                  </p>

                  <div className="mt-3 flex gap-2">
                    <input
                      value={newSourceName}
                      onChange={(event) => setNewSourceName(event.target.value)}
                      placeholder="Source name"
                      className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-bold text-white outline-none focus:border-white"
                    />
                    <button
                      type="button"
                      onClick={createPhotoSource}
                      disabled={busy || !newSourceName.trim() || !station}
                      className="h-9 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <a
                      href="http://127.0.0.1:8780/"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex rounded-lg bg-white px-3 py-2 text-xs font-black text-black"
                    >
                      Worker Setup
                    </a>
                    {newSourceSetupUrl && (
                      <a
                        href={newSourceSetupUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white"
                      >
                        Setup New Source
                      </a>
                    )}
                  </div>

                  {newSourceToken && (
                    <div className="mt-3 rounded-lg border border-yellow-700 bg-yellow-950 p-3">
                      <p className="text-xs font-black text-yellow-200">Copy this token now</p>
                      <code className="mt-2 block break-all text-xs text-yellow-100">{newSourceToken}</code>
                    </div>
                  )}

                  <div className="mt-3 space-y-2">
                    {sources.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-zinc-700 p-3 text-center text-xs font-bold text-zinc-500">
                        No sources yet.
                      </p>
                    ) : (
                      sources.map((source) => (
                        <div key={source.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-black text-white">{source.name}</p>
                              <p className="mt-1 text-xs font-bold text-zinc-500">
                                Last activity: {formatShortDateTime(source.last_activity_at)}
                              </p>
                              <label className="mt-3 block text-[10px] font-black uppercase tracking-wide text-zinc-500">
                                Source file policy
                                <select
                                  value={source.source_file_policy || 'keep_source_file'}
                                  onChange={(event) => updatePhotoSource(source, { source_file_policy: event.target.value })}
                                  disabled={busy}
                                  className="mt-1 h-9 w-full rounded-lg border border-zinc-700 bg-black px-2 text-xs font-bold normal-case tracking-normal text-white outline-none focus:border-white disabled:opacity-50"
                                >
                                  <option value="keep_source_file">Keep source file</option>
                                  <option value="move_to_processed">Move to processed</option>
                                  <option value="delete_source_when_product_photo_deleted">Delete when product photo deleted</option>
                                  <option value="move_source_to_trash_when_product_photo_deleted">Move to trash when product photo deleted</option>
                                </select>
                              </label>
                              <div className="mt-3 grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  onClick={() => updatePhotoSource(source, { enabled: !source.enabled })}
                                  disabled={busy}
                                  className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                                >
                                  {source.enabled ? 'Disable' : 'Enable'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => updatePhotoSource(source, { action: 'rotate_token' })}
                                  disabled={busy}
                                  className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                                >
                                  Rotate Token
                                </button>
                              </div>
                            </div>
                            <span
                              className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${
                                source.enabled && !source.token_revoked_at
                                  ? 'bg-green-600 text-white'
                                  : 'bg-zinc-700 text-zinc-300'
                              }`}
                            >
                              {source.enabled && !source.token_revoked_at ? 'ACTIVE' : 'OFF'}
                            </span>
                          </div>
                          <p className="mt-2 text-xs font-bold text-zinc-500">
                            {source.source_type} - token ****{source.token_last_four || 'none'}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-black p-4">
                  <h3 className="text-sm font-black text-white">Calibration</h3>
                  <p className="mt-1 text-xs font-bold text-zinc-400">
                    Save station/source profiles for colour, ArUco geometry, measurement tuning and lens setup.
                  </p>

                  <div className="mt-3 space-y-2">
                    <input
                      value={newCalibrationName}
                      onChange={(event) => setNewCalibrationName(event.target.value)}
                      placeholder="Profile name"
                      className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-bold text-white outline-none focus:border-white"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={newCalibrationType}
                        onChange={(event) => setNewCalibrationType(event.target.value)}
                        className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-xs font-bold text-white outline-none focus:border-white"
                      >
                        <option value="colour_white_balance">Colour / WB</option>
                        <option value="calibrite_colour_checker">Calibrite Colour Checker</option>
                        <option value="geometry_scale">Geometry / Scale</option>
                        <option value="lens_geometry">Lens Geometry</option>
                      </select>
                      <select
                        value={newCalibrationSourceId}
                        onChange={(event) => setNewCalibrationSourceId(event.target.value)}
                        className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-xs font-bold text-white outline-none focus:border-white"
                      >
                        <option value="">Station default</option>
                        {sources.map((source) => (
                          <option key={source.id} value={source.id}>
                            {source.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {newCalibrationType === 'calibrite_colour_checker' && (
                      <select
                        value={newCalibrationChart}
                        onChange={(event) => setNewCalibrationChart(event.target.value)}
                        className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-xs font-bold text-white outline-none focus:border-white"
                      >
                        <option value="calibrite_colorchecker_classic">Calibrite ColorChecker Classic</option>
                        <option value="calibrite_colorchecker_passport">Calibrite ColorChecker Passport</option>
                        <option value="calibrite_digital_sg">Calibrite Digital SG</option>
                      </select>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={newCalibrationBoardWidthMm}
                        onChange={(event) => setNewCalibrationBoardWidthMm(event.target.value)}
                        placeholder="Board width mm"
                        className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-xs font-bold text-white outline-none focus:border-white"
                      />
                      <input
                        value={newCalibrationBoardHeightMm}
                        onChange={(event) => setNewCalibrationBoardHeightMm(event.target.value)}
                        placeholder="Board height mm"
                        className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-xs font-bold text-white outline-none focus:border-white"
                      />
                      <input
                        value={newCalibrationMarkerSizeMm}
                        onChange={(event) => setNewCalibrationMarkerSizeMm(event.target.value)}
                        placeholder="ArUco marker mm"
                        className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-xs font-bold text-white outline-none focus:border-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowArucoLayoutModal(true)}
                        className="h-9 rounded-lg border border-zinc-700 bg-zinc-800 px-2 text-xs font-black text-white"
                      >
                        ArUco Layout
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={createCalibrationProfile}
                      disabled={busy || !station || !newCalibrationName.trim()}
                      className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                    >
                      Add Calibration Profile
                    </button>
                  </div>

                  <div className="mt-3 space-y-2">
                    {calibrationProfiles.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-zinc-700 p-3 text-center text-xs font-bold text-zinc-500">
                        No calibration profiles yet.
                      </p>
                    ) : (
                      calibrationProfiles.map((profile) => {
                        const source = Array.isArray(profile.source) ? profile.source[0] : profile.source
                        const reference = profile.measured_reference || {}
                        const markerDistances = reference.aruco_marker_distances_mm || {}
                        const calibration = profile.calibration_data || {}
                        return (
                          <div key={profile.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-black text-white">{profile.name}</p>
                                <p className="mt-1 text-xs font-bold text-zinc-500">
                                  {profileTypeLabel(profile.profile_type)}
                                  {source?.name ? ` - ${source.name}` : ' - station default'}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  updateCalibrationProfile(profile, {
                                    status: profile.status === 'active' ? 'disabled' : 'active',
                                  })
                                }
                                disabled={busy}
                                className={`shrink-0 rounded px-2 py-1 text-[10px] font-black text-white disabled:opacity-50 ${
                                  profile.status === 'active' ? 'bg-green-600' : 'bg-zinc-700'
                                }`}
                              >
                                {profile.status === 'active' ? 'ACTIVE' : 'OFF'}
                              </button>
                            </div>

                            <div className="mt-3 grid grid-cols-2 gap-2">
                              {[
                                ['board_width_mm', 'Board W mm', 'measured_reference'],
                                ['board_height_mm', 'Board H mm', 'measured_reference'],
                                ['aruco_marker_size_mm', 'Marker mm', 'measured_reference'],
                                ['measurement_start_trim_percent', 'Start trim %', 'calibration_data'],
                                ['measurement_end_trim_percent', 'End trim %', 'calibration_data'],
                              ].map(([key, label, target]) => (
                                <label key={key} className="block">
                                  <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-zinc-500">
                                    {label}
                                  </span>
                                  <input
                                    defaultValue={target === 'measured_reference' ? reference[key] || '' : calibration[key] || ''}
                                    onBlur={(event) => {
                                      const nextValue = numberOrNull(event.target.value)
                                      if (target === 'measured_reference') {
                                        updateCalibrationProfile(profile, {
                                          measured_reference: {
                                            ...reference,
                                            [key]: nextValue,
                                          },
                                        })
                                      } else {
                                        updateCalibrationProfile(profile, {
                                          calibration_data: {
                                            ...calibration,
                                            [key]: nextValue,
                                          },
                                        })
                                      }
                                    }}
                                    className="h-8 w-full rounded border border-zinc-800 bg-black px-2 text-xs font-bold text-white outline-none focus:border-white"
                                  />
                                </label>
                              ))}

                              {[
                                ['top_left_to_top_right', 'TL to TR mm'],
                                ['top_right_to_bottom_right', 'TR to BR mm'],
                                ['bottom_left_to_bottom_right', 'BL to BR mm'],
                                ['top_left_to_bottom_left', 'TL to BL mm'],
                              ].map(([key, label]) => (
                                <label key={key} className="block">
                                  <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-zinc-500">
                                    {label}
                                  </span>
                                  <input
                                    defaultValue={markerDistances[key] || ''}
                                    onBlur={(event) =>
                                      updateCalibrationProfile(profile, {
                                        measured_reference: {
                                          ...reference,
                                          aruco_marker_distances_mm: {
                                            ...markerDistances,
                                            [key]: numberOrNull(event.target.value),
                                          },
                                        },
                                      })
                                    }
                                    className="h-8 w-full rounded border border-zinc-800 bg-black px-2 text-xs font-bold text-white outline-none focus:border-white"
                                  />
                                </label>
                              ))}
                            </div>

                            <div className="mt-2 flex gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  updateCalibrationProfile(profile, {
                                    measured_reference: {
                                      ...reference,
                                      calibration_capture_id: selectedCapture?.id || null,
                                    },
                                  })
                                }
                                disabled={busy || !selectedCapture}
                                className="rounded border border-zinc-700 px-2 py-1 text-[10px] font-black text-zinc-200 disabled:opacity-50"
                              >
                                Use Selected Photo
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  updateCalibrationProfile(profile, {
                                    measured_reference: {
                                      ...reference,
                                      calibration_capture_id: null,
                                    },
                                  })
                                }
                                disabled={busy || !reference.calibration_capture_id}
                                className="rounded border border-zinc-700 px-2 py-1 text-[10px] font-black text-zinc-200 disabled:opacity-50"
                              >
                                Clear Photo
                              </button>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {processingSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black">
                    {processingSettingsOpen === 'calibration'
                      ? 'Calibration Settings'
                      : processingSettingsOpen === 'crop_rotate'
                        ? 'Crop / Rotate Settings'
                        : 'Background Removal Settings'}
                  </h2>
                  <p className="mt-1 text-sm font-bold text-zinc-400">
                    These settings will be applied when the completion preview pipeline runs.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setProcessingSettingsOpen(null)}
                  className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white"
                >
                  Close
                </button>
              </div>

              {processingSettingsOpen === 'calibration' && (
                <div className="space-y-3">
                  <p className="rounded-lg border border-zinc-800 bg-black p-3 text-xs font-bold text-zinc-400">
                    Uses active calibration profiles from Station Settings. This stage should correct colour and geometry without changing garment colour, shape, or texture.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setProcessingSettingsOpen(null)
                      setShowStationSettings(true)
                    }}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white"
                  >
                    Open Calibration Profiles
                  </button>
                </div>
              )}

              {processingSettingsOpen === 'crop_rotate' && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-emerald-700 bg-emerald-950 p-3 text-xs font-bold text-emerald-100">
                    {cropGuidelineForItem(item)}
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-zinc-500">
                      Edge padding %
                    </span>
                    <input
                      placeholder="Reserved for crop processor"
                      className="h-9 w-full rounded-lg border border-zinc-700 bg-black px-3 text-xs font-bold text-white outline-none focus:border-white"
                    />
                  </label>
                  <p className="rounded-lg border border-zinc-800 bg-black p-3 text-xs font-bold text-zinc-400">
                    Category crop will use the item's category and sub category to choose safe framing rules. Smart crop, deskew, rotation, and manual handles still need the next processor pass.
                  </p>
                </div>
              )}

              {processingSettingsOpen === 'background' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-xs font-black text-white">
                    <span>Preserve garment colour and texture</span>
                    <ToggleSwitch checked onChange={() => undefined} label="Preserve garment colour and texture" />
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-zinc-500">
                      Background output
                    </span>
                    <select className="h-9 w-full rounded-lg border border-zinc-700 bg-black px-3 text-xs font-bold text-white outline-none focus:border-white">
                      <option>Transparent PNG</option>
                      <option>White background</option>
                      <option>Light grey background</option>
                    </select>
                  </label>
                  <p className="rounded-lg border border-zinc-800 bg-black p-3 text-xs font-bold text-zinc-400">
                    The current background engine is temporary. The next engine should expose matting/edge/shadow controls and must not alter item colour, silhouette, labels, flaws, or fabric texture.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {aiComparisonOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <div className="flex max-h-[90vh] w-full max-w-6xl flex-col rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black">AI Enhance Preview</h2>
                  <p className="mt-1 text-sm font-bold text-zinc-300">
                    Side-by-side review before any AI version can replace the selected image.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAiComparisonOpen(false)}
                  className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white"
                >
                  Close
                </button>
              </div>

              <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-2">
                <div className="flex min-h-[320px] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-black">
                  <div className="border-b border-zinc-800 px-3 py-2 text-xs font-black uppercase tracking-wide text-zinc-300">
                    Current
                  </div>
                  <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
                    {displayUrl ? (
                      <img src={displayUrl} alt="" className="max-h-full max-w-full object-contain" />
                    ) : (
                      <p className="text-sm font-bold text-zinc-500">No selected image.</p>
                    )}
                  </div>
                </div>

                <div className="flex min-h-[320px] flex-col overflow-hidden rounded-xl border border-dashed border-zinc-700 bg-zinc-900">
                  <div className="border-b border-zinc-800 px-3 py-2 text-xs font-black uppercase tracking-wide text-zinc-300">
                    AI Enhanced
                  </div>
                  <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6 text-center">
                    <div className="max-w-md rounded-xl border border-zinc-700 bg-zinc-950 p-4">
                      <p className="text-sm font-black text-white">AI image processor not connected yet.</p>
                      <p className="mt-2 text-xs font-bold text-zinc-300">
                        This stage should only improve presentation while preserving colour, shape, labels, flaws,
                        fabric texture, and all product details. It will need a generated preview here before Accept is enabled.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-bold text-zinc-400">
                  AI enhancement will sit after calibration, crop/rotate, and background removal so it works from the cleanest truthful source.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAiComparisonOpen(false)}
                    className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-black text-white"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    disabled
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white opacity-50"
                    title="Enable once the AI image processor produces a preview."
                  >
                    Accept
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {phonePairExpanded && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            onClick={closePhonePairQr}
          >
            <div
              className="w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black">Pair Phone</h2>
                  <p className="mt-1 text-sm font-bold text-zinc-300">
                    Scan this QR with the phone camera used for this station.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closePhonePairQr}
                  className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white"
                >
                  Close
                </button>
              </div>

              <div className="rounded-xl bg-white p-4">
                <QRCode value={phonePairUrl} size={280} />
              </div>
              <p className="mt-3 break-all text-[10px] font-bold text-zinc-300">{phonePairUrl}</p>
              {phonePairExpiresAt && (
                <p className="mt-2 text-xs font-bold text-zinc-400">
                  Expires {formatShortDateTime(phonePairExpiresAt)}
                </p>
              )}
              {/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(phonePairUrl) && (
                <p className="mt-3 rounded-lg border border-yellow-700 bg-yellow-950 p-3 text-xs font-black text-yellow-100">
                  This QR points to localhost, which only works on this PC. For a real phone, open Photo Monitor on the
                  station PC using its LAN address, for example http://192.168.x.x:3000, or use the deployed domain.
                </p>
              )}
              <button
                type="button"
                onClick={createPhonePairing}
                disabled={busy}
                className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
              >
                Refresh QR
              </button>
            </div>
          </div>
        )}

        <section className="grid h-[calc(100vh-150px)] min-h-[560px] gap-4 overflow-hidden lg:grid-cols-[330px_1fr]">
          <aside className="order-2 min-h-0 space-y-4 overflow-y-auto pr-1 lg:order-1">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-lg font-black">Images</h2>
                {images.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setBatchSelectedImageIds(
                        batchSelectedImageIds.length === images.length ? [] : images.map((image) => image.id)
                      )
                    }
                    className="rounded bg-zinc-800 px-2 py-1 text-[10px] font-black text-white"
                  >
                    {batchSelectedImageIds.length === images.length ? 'Clear' : 'All'}
                  </button>
                )}
              </div>

              {images.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-700 p-4 text-center text-sm font-bold text-zinc-500">
                  No session photos yet.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {thumbnailImages.map((image) => {
                    const active = selectedImage?.id === image.id
                    const batchSelected = batchSelectedImageIds.includes(image.id)
                    return (
                      <div
                        key={image.id}
                        className={`group relative overflow-hidden rounded-lg border ${
                          active ? 'border-white' : 'border-zinc-700'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedImageId(image.id)}
                          className="block w-full"
                        >
                          <img
                            src={imageUrl(image)}
                            alt=""
                            className="aspect-square w-full object-cover"
                          />
                        </button>
                        <label className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded bg-black/70">
                          <input
                            type="checkbox"
                            checked={batchSelected}
                            onChange={() => toggleBatchImage(image.id)}
                            className="h-3.5 w-3.5"
                            title="Include in batch"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            deleteSelectedImage(image)
                          }}
                          disabled={busy}
                          className="absolute right-1 top-1 rounded bg-red-700 px-1.5 py-0.5 text-[10px] font-black text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 focus:opacity-100 disabled:opacity-40"
                          title="Delete photo"
                        >
                          X
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black">Session</h2>
                  <p className="text-xs font-bold text-zinc-300">
                    {session?.status === 'active' ? `${images.length} photo${images.length === 1 ? '' : 's'} ready` : 'No active session'}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-black ${
                    session?.status === 'active' ? 'bg-green-600 text-white' : 'bg-zinc-800 text-zinc-200'
                  }`}
                >
                  {session?.status === 'active' ? 'LIVE' : 'IDLE'}
                </span>
              </div>

              <div
                className="relative mt-4 rounded-xl border border-zinc-700 bg-zinc-950 p-3"
                onMouseEnter={() => {
                  if (phonePairHoverTimerRef.current) clearTimeout(phonePairHoverTimerRef.current)
                  phonePairHoverTimerRef.current = setTimeout(() => setPhonePairHoverExpanded(true), 2000)
                }}
                onMouseLeave={() => {
                  if (phonePairHoverTimerRef.current) clearTimeout(phonePairHoverTimerRef.current)
                  setPhonePairHoverExpanded(false)
                }}
              >
                <button
                  type="button"
                  onClick={async () => {
                    if (!phonePairUrl) {
                      const nextPairUrl = await createPhonePairing()
                      if (nextPairUrl) setPhonePairPinned(true)
                      return
                    }
                    setPhonePairPinned((current) => !current)
                  }}
                  disabled={busy || !station}
                  className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                >
                  Pair Phone To Session
                </button>

                {phonePairUrl ? (
                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setPhonePairPinned((current) => !current)}
                      className="rounded-lg bg-white p-2"
                      title="Open larger phone pairing QR"
                    >
                      <QRCode value={phonePairUrl} size={54} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-black text-white">Phone camera ready</p>
                      <p className="truncate text-[10px] font-bold text-zinc-300">
                        {phonePairExpiresAt ? `Expires ${formatShortDateTime(phonePairExpiresAt)}` : 'Tap QR to enlarge'}
                      </p>
                      {/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(phonePairUrl) && (
                        <p className="mt-1 text-[10px] font-black text-yellow-300">
                          Phone cannot reach localhost. Use the station PC LAN address or deployed domain.
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-[10px] font-bold text-zinc-400">
                    Creates a QR for phone capture into this station.
                  </p>
                )}
              </div>

              <div className="mt-4 space-y-2">
                {[
                  {
                    key: 'calibration',
                    label: 'Calibration',
                    enabled: batchRunCalibration,
                    setEnabled: setBatchRunCalibration,
                    status: calibratedRepresentation?.public_url ? 'ready' : 'not generated',
                  },
                  {
                    key: 'crop_rotate',
                    label: 'Category crop / rotate',
                    enabled: batchRunAutoCropRotate,
                    setEnabled: setBatchRunAutoCropRotate,
                    status: processedRepresentation?.public_url ? 'ready' : 'not generated',
                  },
                  {
                    key: 'background',
                    label: 'Background removal',
                    enabled: batchRunBackgroundRemoval,
                    setEnabled: setBatchRunBackgroundRemoval,
                    status: backgroundRepresentation?.public_url ? 'ready' : 'not generated',
                  },
                ].map((option) => (
                  <div key={option.key} className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 p-2">
                    <div className="flex min-w-0 flex-1 items-center justify-between gap-3 text-xs font-black text-white">
                      <span className="min-w-0">
                        {option.label}
                        <span className="ml-2 text-[10px] font-bold text-zinc-300">{option.status}</span>
                      </span>
                      <ToggleSwitch
                        checked={option.enabled}
                        onChange={option.setEnabled}
                        label={option.label}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setProcessingSettingsOpen(option.key as 'calibration' | 'crop_rotate' | 'background')}
                      className="flex h-8 w-8 items-center justify-center rounded bg-zinc-800 text-white"
                      title={`${option.label} settings`}
                      aria-label={`${option.label} settings`}
                    >
                      <SettingsCogIcon />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAiComparisonOpen(true)}
                  disabled={!selectedImage}
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                >
                  AI Enhance
                </button>
                <button
                  type="button"
                  onClick={() => deleteSelectedImage()}
                  disabled={busy || !selectedImage}
                  className="rounded-lg bg-red-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                >
                  Delete Selected
                </button>
                <button
                  type="button"
                  onClick={startCompletePhotosWorkflow}
                  disabled={busy || !session || images.length === 0}
                  className="col-span-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                >
                  Complete Photos
                </button>
              </div>
            </div>

            <div className="hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black">Session</h2>
                  <p className="text-xs font-bold text-zinc-400">
                    {session?.status === 'active' ? `${images.length} photo${images.length === 1 ? '' : 's'} ready` : 'No active session'}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-black ${
                    session?.status === 'active' ? 'bg-green-600 text-white' : 'bg-zinc-800 text-zinc-300'
                  }`}
                >
                  {session?.status === 'active' ? 'LIVE' : 'IDLE'}
                </span>
              </div>

              <div className="mt-4 space-y-2">
                {[
                  {
                    key: 'calibration',
                    label: 'Calibration',
                    enabled: batchRunCalibration,
                    setEnabled: setBatchRunCalibration,
                    status: calibratedRepresentation?.public_url ? 'ready' : 'not generated',
                  },
                  {
                    key: 'crop_rotate',
                    label: 'Category crop / rotate',
                    enabled: batchRunAutoCropRotate,
                    setEnabled: setBatchRunAutoCropRotate,
                    status: processedRepresentation?.public_url ? 'ready' : 'not generated',
                  },
                  {
                    key: 'background',
                    label: 'Background removal',
                    enabled: batchRunBackgroundRemoval,
                    setEnabled: setBatchRunBackgroundRemoval,
                    status: backgroundRepresentation?.public_url ? 'ready' : 'not generated',
                  },
                ].map((option) => (
                  <div key={option.key} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-black p-2">
                    <label className="flex min-w-0 flex-1 items-center justify-between gap-3 text-xs font-black text-white">
                      <span className="min-w-0">
                        {option.label}
                        <span className="ml-2 text-[10px] font-bold text-zinc-500">{option.status}</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={option.enabled}
                        onChange={(event) => option.setEnabled(event.target.checked)}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setProcessingSettingsOpen(option.key as 'calibration' | 'crop_rotate' | 'background')}
                      className="flex h-8 w-8 items-center justify-center rounded bg-zinc-800 text-base font-black text-white"
                      title={`${option.label} settings`}
                      aria-label={`${option.label} settings`}
                    >
                      ⚙
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => deleteSelectedImage()}
                  disabled={busy || !selectedImage}
                  className="rounded-lg bg-red-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                >
                  Delete Selected
                </button>
                <button
                  type="button"
                  onClick={startCompletePhotosWorkflow}
                  disabled={busy || !session || images.length === 0}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                >
                  Complete Photos
                </button>
              </div>
            </div>

            <div className="hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black">Batch Pipeline</h2>
                  <p className="text-xs font-bold text-zinc-400">
                    {batchSelectedImageIds.length > 0 ? `${batchSelectedImageIds.length} selected` : 'All photos'}.
                    Preview first, then accept or revert.
                  </p>
                </div>
              </div>

              <div className="mt-3 space-y-2 text-xs font-black text-white">
                <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-black p-3">
                  <span>Apply active calibration</span>
                  <input
                    type="checkbox"
                    checked={batchRunCalibration}
                    onChange={(event) => setBatchRunCalibration(event.target.checked)}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-black p-3">
                  <span>Remove background</span>
                  <input
                    type="checkbox"
                    checked={batchRunBackgroundRemoval}
                    onChange={(event) => setBatchRunBackgroundRemoval(event.target.checked)}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-black p-3">
                  <span>Auto crop / rotate preview</span>
                  <input
                    type="checkbox"
                    checked={batchRunAutoCropRotate}
                    onChange={(event) => setBatchRunAutoCropRotate(event.target.checked)}
                  />
                </label>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={runBatchPreviewPipeline}
                  disabled={busy || images.length === 0}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                >
                  Run Preview
                </button>
                <button
                  type="button"
                  onClick={acceptBatchPreviewPipeline}
                  disabled={busy || images.length === 0}
                  className="rounded-lg bg-white px-3 py-2 text-xs font-black text-black disabled:opacity-40"
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={revertBatchPreviewPipeline}
                  disabled={busy || images.length === 0}
                  className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                >
                  Revert
                </button>
              </div>
            </div>

            <div className="hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black">Live QC</h2>
                  <p className="text-xs font-bold text-zinc-400">
                    {images.length} photo{images.length === 1 ? '' : 's'} Â· {captures.length} session capture{captures.length === 1 ? '' : 's'}
                  </p>
                </div>

                <span
                  className={`rounded-full px-3 py-1 text-xs font-black ${
                    session?.status === 'active' ? 'bg-green-600 text-white' : 'bg-zinc-800 text-zinc-300'
                  }`}
                >
                  {session?.status === 'active' ? 'LIVE' : 'IDLE'}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                {[
                  { mode: 'original' as PhotoViewMode, label: 'Original', available: Boolean(selectedImage?.original_url) },
                  { mode: 'calibrated' as PhotoViewMode, label: 'Calibrated', available: Boolean(calibratedRepresentation?.public_url) },
                  { mode: 'processed' as PhotoViewMode, label: 'Preview', available: Boolean(processedRepresentation?.public_url) },
                  { mode: 'background' as PhotoViewMode, label: 'BG Removed', available: Boolean(backgroundRepresentation?.public_url) },
                ].map((option) => (
                  <button
                    key={option.mode}
                    type="button"
                    onClick={() => setViewMode(option.mode)}
                    disabled={!option.available}
                    className={`rounded-lg px-3 py-2 text-xs font-black text-white disabled:opacity-40 ${
                      viewMode === option.mode ? 'bg-emerald-600' : 'bg-zinc-800'
                    }`}
                    title={option.available ? `Show ${option.label}` : `${option.label} has not been generated yet.`}
                  >
                    {option.label}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => setShowMeasurements((current) => !current)}
                  className={`rounded-lg px-3 py-2 text-xs font-black text-white ${
                    showMeasurements ? 'bg-emerald-600' : 'bg-zinc-800'
                  }`}
                >
                  Measurements
                </button>

                <button
                  type="button"
                  onClick={() => setAutoPreviewNewest((current) => !current)}
                  className={`rounded-lg px-3 py-2 text-xs font-black text-white ${
                    autoPreviewNewest ? 'bg-emerald-600' : 'bg-zinc-800'
                  }`}
                >
                  Newest {autoPreviewNewest ? 'On' : 'Off'}
                </button>

                <button
                  type="button"
                  onClick={() => deleteSelectedImage()}
                  disabled={busy || !selectedImage}
                  className="rounded-lg bg-red-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                >
                  Delete
                </button>

                <button
                  type="button"
                  onClick={applyViewedRepresentation}
                  disabled={busy || !viewedProcessedRepresentation?.public_url}
                  className="col-span-2 rounded-lg bg-white px-3 py-2 text-xs font-black text-black disabled:opacity-40"
                  title={
                    viewedProcessedRepresentation?.public_url
                      ? 'Use the currently viewed processed image for this item.'
                      : 'View a generated processed image first.'
                  }
                >
                  Use This Version
                </button>
              </div>

              {showMeasurements && (
                <p className="mt-3 rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-xs font-bold text-zinc-400">
                  Measurement overlay is reserved for the automatic first-photo pipeline.
                </p>
              )}

              <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => completeSession('complete')}
                    disabled={busy || !session || images.length === 0}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                    title={images.length === 0 ? 'Add at least one photo before completing.' : 'Complete session'}
                  >
                    Complete
                  </button>
                  <button
                    type="button"
                    onClick={() => completeSession('needs_reshoot')}
                    disabled={busy || !session}
                    className="rounded-lg bg-yellow-600 px-3 py-2 text-xs font-black text-black disabled:opacity-50"
                  >
                    Needs Reshoot
                  </button>
                </div>
              </div>
            </div>

            <div className="hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black">Live QC</h2>
                  <p className="text-xs font-bold text-zinc-400">
                    {images.length} photo{images.length === 1 ? '' : 's'} · {captures.length} session capture{captures.length === 1 ? '' : 's'}
                  </p>
                </div>

                <span
                  className={`rounded-full px-3 py-1 text-xs font-black ${
                    session?.status === 'active' ? 'bg-green-600 text-white' : 'bg-zinc-800 text-zinc-300'
                  }`}
                >
                  {session?.status === 'active' ? 'LIVE' : 'IDLE'}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                {[
                  { mode: 'original' as PhotoViewMode, label: 'Original', available: Boolean(selectedImage?.original_url) },
                  { mode: 'calibrated' as PhotoViewMode, label: 'Calibrated', available: Boolean(calibratedRepresentation?.public_url) },
                  { mode: 'processed' as PhotoViewMode, label: 'Preview', available: Boolean(processedRepresentation?.public_url) },
                  { mode: 'background' as PhotoViewMode, label: 'BG Removed', available: Boolean(backgroundRepresentation?.public_url) },
                ].map((option) => (
                  <button
                    key={option.mode}
                    type="button"
                    onClick={() => setViewMode(option.mode)}
                    disabled={!option.available}
                    className={`rounded-lg px-3 py-2 text-xs font-black text-white disabled:opacity-40 ${
                      viewMode === option.mode ? 'bg-emerald-600' : 'bg-zinc-800'
                    }`}
                    title={option.available ? `Show ${option.label}` : `${option.label} has not been generated yet.`}
                  >
                    {option.label}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => setShowMeasurements((current) => !current)}
                  className={`rounded-lg px-3 py-2 text-xs font-black text-white ${
                    showMeasurements ? 'bg-emerald-600' : 'bg-zinc-800'
                  }`}
                >
                  Measurements
                </button>

                <button
                  type="button"
                  onClick={() => setAutoPreviewNewest((current) => !current)}
                  className={`rounded-lg px-3 py-2 text-xs font-black text-white ${
                    autoPreviewNewest ? 'bg-emerald-600' : 'bg-zinc-800'
                  }`}
                >
                  Newest {autoPreviewNewest ? 'On' : 'Off'}
                </button>

                <button
                  type="button"
                  onClick={() => deleteSelectedImage()}
                  disabled={busy || !selectedImage}
                  className="rounded-lg bg-red-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                >
                  Delete
                </button>
              </div>

              {showMeasurements && (
                <p className="mt-3 rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-xs font-bold text-zinc-400">
                  Measurement overlay is reserved for the automatic first-photo pipeline.
                </p>
              )}

              <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                <label className="text-xs font-black uppercase tracking-wide text-zinc-400">
                  QC notes
                  <textarea
                    value={qcNotes}
                    onChange={(event) => setQcNotes(event.target.value)}
                    placeholder="Optional notes, missing angle, reshoot reason..."
                    className="mt-2 min-h-20 w-full resize-none rounded-lg border border-zinc-700 bg-black p-3 text-sm font-bold normal-case tracking-normal text-white outline-none focus:border-white"
                  />
                </label>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => completeSession('complete')}
                    disabled={busy || !session || images.length === 0}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                    title={images.length === 0 ? 'Add at least one photo before completing.' : 'Complete session'}
                  >
                    Complete
                  </button>
                  <button
                    type="button"
                    onClick={() => completeSession('needs_reshoot')}
                    disabled={busy || !session}
                    className="rounded-lg bg-yellow-600 px-3 py-2 text-xs font-black text-black disabled:opacity-50"
                  >
                    Needs Reshoot
                  </button>
                </div>
              </div>
            </div>

            <div className="hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black">Capture Architecture</h2>
                  <p className="text-xs font-bold text-zinc-400">
                    Original, RAW, calibration and first-photo measurement state.
                  </p>
                </div>
                <span className="rounded bg-zinc-800 px-2 py-1 text-[10px] font-black text-zinc-300">
                  {activeCalibrationCount} calibration{activeCalibrationCount === 1 ? '' : 's'}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-black">
                <div className="rounded-lg border border-zinc-800 bg-black p-3">
                  <p className="text-zinc-500">Camera Original</p>
                  <p className="mt-1 text-white">
                    {representationTypes.has('camera_original_jpeg') ? 'Stored' : selectedImage ? 'Legacy image' : 'Waiting'}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-black p-3">
                  <p className="text-zinc-500">RAW Original</p>
                  <p className="mt-1 text-white">
                    {rawRepresentation ? rawRepresentation.original_filename || 'Paired locally' : 'Not paired'}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-black p-3">
                  <p className="text-zinc-500">Calibrated Preview</p>
                  <p className="mt-1 text-white">
                    {calibratedRepresentation?.public_url ? 'Available' : 'Not generated'}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-black p-3">
                  <p className="text-zinc-500">Measurement Source</p>
                  <p className="mt-1 text-white">
                    {selectedIsMeasurementSource
                      ? 'This photo'
                      : measurementSourceCaptureId
                        ? 'Another photo'
                        : session?.measurement_status || 'Not selected'}
                  </p>
                </div>
              </div>

              {rawRepresentation?.local_reference?.raw_available && (
                <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs font-bold text-zinc-400">
                  RAW is retained locally by the worker and has not been uploaded to Loopbase.
                </p>
              )}

              {viewMode === 'calibrated' && selectedImage && !calibratedRepresentation?.public_url && (
                <p className="mt-3 rounded-lg border border-yellow-700 bg-yellow-950 p-3 text-xs font-bold text-yellow-100">
                  No calibrated preview exists yet, so the monitor is showing the camera original.
                </p>
              )}
            </div>

            <div className="hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black">Processing Jobs</h2>
                  <p className="text-xs font-bold text-zinc-400">
                    Queue work for calibrated previews and first-photo measurement analysis.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => fetchProcessingJobs()}
                    disabled={!selectedCapture}
                    className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    onClick={cancelActiveSessionProcessingJobs}
                    disabled={busy || !session?.id}
                    className="rounded-lg bg-red-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                    title="Cancel queued or running processor jobs for the active photo session."
                  >
                    Cancel Active
                  </button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => queueProcessingJob('calibrated_preview')}
                  disabled={busy || !selectedCapture}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                  title={!selectedCapture ? 'Select a captured photo first.' : 'Queue a calibrated preview for the selected photo.'}
                >
                  Queue Calibrated
                </button>
                <button
                  type="button"
                  onClick={() => queueProcessingJob('measurement_analysis')}
                  disabled={busy || !selectedCapture || !selectedIsMeasurementSource}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                  title={
                    selectedIsMeasurementSource
                      ? 'Queue measurement analysis for the first measurement-source photo.'
                      : 'Select the measurement-source photo before queueing measurements.'
                  }
                >
                  Queue Measures
                </button>
                <button
                  type="button"
                  onClick={() => queueProcessingJob('background_removal')}
                  disabled={busy || !selectedCapture}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                  title={!selectedCapture ? 'Select a captured photo first.' : 'Queue background removal for the selected photo.'}
                >
                  Remove BG
                </button>
                <button
                  type="button"
                  onClick={() => queueProcessingJob('processed_preview')}
                  disabled={busy || !selectedCapture}
                  className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                  title={!selectedCapture ? 'Select a captured photo first.' : 'Queue a processed preview copy.'}
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => queueProcessingJob('raw_development')}
                  disabled={busy || !selectedCapture || !rawRepresentation}
                  className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                  title={rawRepresentation ? 'Queue RAW development from the paired local RAW file.' : 'No paired RAW file is recorded for this photo.'}
                >
                  RAW Dev
                </button>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-black">
                <div className="rounded-lg border border-zinc-800 bg-black p-3">
                  <p className="text-zinc-500">Calibrated Preview</p>
                  <p className="mt-1 text-white">
                    {latestCalibrationJob ? latestCalibrationJob.status.replace(/_/g, ' ') : 'Not queued'}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-black p-3">
                  <p className="text-zinc-500">Measurements</p>
                  <p className="mt-1 text-white">
                    {latestMeasurementJob ? latestMeasurementJob.status.replace(/_/g, ' ') : 'Not queued'}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-black p-3">
                  <p className="text-zinc-500">Background</p>
                  <p className="mt-1 text-white">
                    {latestBackgroundJob ? latestBackgroundJob.status.replace(/_/g, ' ') : 'Not queued'}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-black p-3">
                  <p className="text-zinc-500">Processed Preview</p>
                  <p className="mt-1 text-white">
                    {latestPreviewJob ? latestPreviewJob.status.replace(/_/g, ' ') : 'Not queued'}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-black p-3">
                  <p className="text-zinc-500">RAW Development</p>
                  <p className="mt-1 text-white">
                    {latestRawJob ? latestRawJob.status.replace(/_/g, ' ') : 'Not queued'}
                  </p>
                </div>
              </div>

              {processingJobs.length === 0 ? (
                <p className="mt-3 rounded-lg border border-dashed border-zinc-700 p-3 text-center text-xs font-bold text-zinc-500">
                  No processing jobs for this photo.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {processingJobs.slice(0, 5).map((job) => {
                    const activeJob = activeProcessingJobs.some((active) => active.id === job.id)
                    return (
                      <div key={job.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black">
                              {processingJobLabel(job.job_type)}
                            </p>
                            <p className="mt-1 text-xs font-bold text-zinc-500">
                              {job.processing_source.replace(/_/g, ' ')} - {formatShortDateTime(job.queued_at)}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 rounded px-2 py-1 text-[10px] font-black ${
                              job.status === 'completed'
                                ? 'bg-green-600 text-white'
                                : job.status === 'failed'
                                  ? 'bg-red-700 text-white'
                                  : activeJob
                                    ? 'bg-yellow-600 text-black'
                                    : 'bg-zinc-700 text-zinc-200'
                            }`}
                          >
                            {job.status.replace(/_/g, ' ')}
                          </span>
                        </div>
                        {job.error_message && (
                          <p className="mt-2 rounded bg-red-950 p-2 text-xs font-bold text-red-100">
                            {job.error_message}
                          </p>
                        )}
                        {activeJob && (
                          <button
                            type="button"
                            onClick={() => cancelProcessingJob(job)}
                            disabled={busy}
                            className="mt-2 rounded border border-zinc-700 px-2 py-1 text-[10px] font-black text-zinc-200 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <h2 className="mb-3 text-lg font-black">Thumbnails</h2>

              {images.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-700 p-4 text-center text-sm font-bold text-zinc-500">
                  No session photos yet.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {images.map((image, index) => {
                    const active = selectedImage?.id === image.id
                    return (
                      <button
                        key={image.id}
                        type="button"
                        onClick={() => setSelectedImageId(image.id)}
                        className={`relative overflow-hidden rounded-lg border ${
                          active ? 'border-white' : 'border-zinc-700'
                        }`}
                      >
                        <img
                          src={imageUrl(image)}
                          alt=""
                          className="aspect-square w-full object-cover"
                        />
                        <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-black text-white">
                          {index + 1}
                        </span>
                        {captureByImageId.has(image.id) && (
                          <span className="absolute bottom-1 right-1 rounded bg-green-600 px-1.5 py-0.5 text-[10px] font-black text-white">
                            {photoRoleLabel(captureByImageId.get(image.id)?.exif?.photo_role) || 'Session'}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black">Recent Sessions</h2>
                  <p className="text-xs font-bold text-zinc-400">
                    Latest activity for this station.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => fetchSessionHistory()}
                  className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white"
                >
                  Refresh
                </button>
              </div>

              {sessionHistory.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-700 p-3 text-center text-xs font-bold text-zinc-500">
                  No sessions yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {sessionHistory.map((row) => {
                    const historyItem = Array.isArray(row.item) ? row.item[0] : row.item
                    return (
                      <div key={row.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black">
                              {historyItem?.sku || 'Unknown item'}
                            </p>
                            <p className="truncate text-xs font-bold text-zinc-500">
                              {itemTitle(historyItem)}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span
                              className={`rounded px-2 py-1 text-[10px] font-black ${
                                row.status === 'active'
                                  ? 'bg-green-600 text-white'
                                  : 'bg-zinc-800 text-zinc-300'
                              }`}
                            >
                              {row.status || 'unknown'}
                            </span>
                            {row.qc_status && row.qc_status !== 'pending' && (
                              <span
                                className={`rounded px-2 py-1 text-[10px] font-black ${
                                  row.qc_status === 'complete'
                                    ? 'bg-emerald-600 text-white'
                                    : row.qc_status === 'needs_reshoot'
                                      ? 'bg-yellow-600 text-black'
                                      : 'bg-zinc-700 text-zinc-200'
                                }`}
                              >
                                {row.qc_status.replace(/_/g, ' ')}
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="mt-2 text-xs font-bold text-zinc-500">
                          {formatShortDateTime(row.started_at)} - {row.start_method || 'manual'}
                        </p>
                        {row.qc_notes && (
                          <p className="mt-2 rounded bg-black p-2 text-xs font-bold text-zinc-400">
                            {row.qc_notes}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black">Unassigned</h2>
                  <p className="text-xs font-bold text-zinc-400">
                    Photos received with no active session.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => fetchUnassignedCaptures()}
                  className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white"
                >
                  Refresh
                </button>
              </div>

              {unassignedWithImages.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-700 p-3 text-center text-xs font-bold text-zinc-500">
                  No unassigned photos.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {unassignedWithImages.map((capture) => (
                    <button
                      key={capture.id}
                      type="button"
                      onClick={() => assignCaptureToSession(capture)}
                      disabled={busy || !session}
                      className="relative overflow-hidden rounded-lg border border-yellow-600 disabled:opacity-50"
                      title={session ? 'Attach to active session' : 'Start a session first'}
                    >
                      <img
                        src={capture.exif?.public_url}
                        alt=""
                        className="aspect-square w-full object-cover"
                      />
                      <span className="absolute bottom-1 left-1 rounded bg-yellow-600 px-1.5 py-0.5 text-[10px] font-black text-black">
                        Attach
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <h2 className="text-lg font-black">Station Setup</h2>
              <p className="mt-1 text-xs font-bold text-zinc-400">
                Create or rename camera benches for this company.
              </p>

              <div className="mt-3 space-y-2">
                <div className="flex gap-2">
                  <input
                    value={editingStationName}
                    onChange={(event) => setEditingStationName(event.target.value)}
                    placeholder="Selected station name"
                    disabled={!station}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-black px-3 text-xs font-bold text-white outline-none focus:border-white disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={renameStation}
                    disabled={busy || !station || !editingStationName.trim() || editingStationName.trim() === station.name}
                    className="h-9 rounded-lg bg-zinc-800 px-3 text-xs font-black text-white disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>

                <div className="flex gap-2">
                  <input
                    value={newStationName}
                    onChange={(event) => setNewStationName(event.target.value)}
                    placeholder="New station name"
                    className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-black px-3 text-xs font-bold text-white outline-none focus:border-white"
                  />
                  <button
                    type="button"
                    onClick={createStation}
                    disabled={busy || !newStationName.trim()}
                    className="h-9 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>

                <button
                  type="button"
                  onClick={archiveStation}
                  disabled={busy || !station || Boolean(session)}
                  className="w-full rounded-lg border border-red-900 bg-red-950 px-3 py-2 text-xs font-black text-red-100 disabled:opacity-50"
                  title={session ? 'End the active session before archiving.' : 'Archive selected station'}
                >
                  Archive Selected Station
                </button>

                <div className="grid gap-2 pt-2 sm:grid-cols-2">
                  <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-black p-3 text-xs font-black text-zinc-200">
                    <span>RFID auto-start</span>
                    <input
                      type="checkbox"
                      checked={station?.auto_start_from_rfid === true}
                      disabled={busy || !station}
                      onChange={(event) =>
                        updateStationSettings({ auto_start_from_rfid: event.target.checked })
                      }
                      className="h-4 w-4"
                    />
                  </label>

                  <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-black p-3 text-xs font-black text-zinc-200">
                    <span>Barcode auto-start</span>
                    <input
                      type="checkbox"
                      checked={station?.auto_start_from_barcode === true}
                      disabled={busy || !station}
                      onChange={(event) =>
                        updateStationSettings({ auto_start_from_barcode: event.target.checked })
                      }
                      className="h-4 w-4"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black">Phone Capture</h2>
                  <p className="mt-1 text-xs font-bold text-zinc-400">
                    Pair a phone to this station. QR tokens expire after 10 minutes.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={createPhonePairing}
                  disabled={busy || !station}
                  className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                >
                  Pair Phone
                </button>
              </div>

              {phonePairUrl && (
                <div className="mt-3 rounded-xl border border-zinc-800 bg-white p-3 text-black">
                  <div className="mx-auto w-fit">
                    <QRCode value={phonePairUrl} size={180} />
                  </div>
                  <p className="mt-3 break-all text-center text-[11px] font-bold text-zinc-700">
                    {phonePairUrl}
                  </p>
                  {phonePairExpiresAt && (
                    <p className="mt-2 text-center text-xs font-black text-zinc-500">
                      Expires {formatShortDateTime(phonePairExpiresAt)}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="mb-3">
                <h2 className="text-lg font-black">Calibration Profiles</h2>
                <p className="text-xs font-bold text-zinc-400">
                  Save station/source profiles for colour, ArUco geometry, measurement tuning and lens setup.
                </p>
              </div>

              <div className="space-y-2">
                <input
                  value={newCalibrationName}
                  onChange={(event) => setNewCalibrationName(event.target.value)}
                  placeholder="Profile name"
                  className="h-9 w-full rounded-lg border border-zinc-700 bg-black px-3 text-xs font-bold text-white outline-none focus:border-white"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={newCalibrationType}
                    onChange={(event) => setNewCalibrationType(event.target.value)}
                    className="h-9 rounded-lg border border-zinc-700 bg-black px-2 text-xs font-bold text-white outline-none focus:border-white"
                  >
                    <option value="colour_white_balance">Colour / WB</option>
                    <option value="calibrite_colour_checker">Calibrite Colour Checker</option>
                    <option value="geometry_scale">Geometry / Scale</option>
                    <option value="lens_geometry">Lens Geometry</option>
                  </select>
                  <select
                    value={newCalibrationSourceId}
                    onChange={(event) => setNewCalibrationSourceId(event.target.value)}
                    className="h-9 rounded-lg border border-zinc-700 bg-black px-2 text-xs font-bold text-white outline-none focus:border-white"
                  >
                    <option value="">Station default</option>
                    {sources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.name}
                      </option>
                    ))}
                  </select>
                </div>

                {newCalibrationType === 'calibrite_colour_checker' && (
                  <select
                    value={newCalibrationChart}
                    onChange={(event) => setNewCalibrationChart(event.target.value)}
                    className="h-9 w-full rounded-lg border border-zinc-700 bg-black px-2 text-xs font-bold text-white outline-none focus:border-white"
                  >
                    <option value="calibrite_colorchecker_classic">Calibrite ColorChecker Classic</option>
                    <option value="calibrite_colorchecker_passport">Calibrite ColorChecker Passport</option>
                    <option value="calibrite_digital_sg">Calibrite Digital SG</option>
                  </select>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={newCalibrationBoardWidthMm}
                    onChange={(event) => setNewCalibrationBoardWidthMm(event.target.value)}
                    placeholder="Board width mm"
                    className="h-9 rounded-lg border border-zinc-700 bg-black px-2 text-xs font-bold text-white outline-none focus:border-white"
                  />
                  <input
                    value={newCalibrationBoardHeightMm}
                    onChange={(event) => setNewCalibrationBoardHeightMm(event.target.value)}
                    placeholder="Board height mm"
                    className="h-9 rounded-lg border border-zinc-700 bg-black px-2 text-xs font-bold text-white outline-none focus:border-white"
                  />
                  <input
                    value={newCalibrationMarkerSizeMm}
                    onChange={(event) => setNewCalibrationMarkerSizeMm(event.target.value)}
                    placeholder="ArUco marker mm"
                    className="h-9 rounded-lg border border-zinc-700 bg-black px-2 text-xs font-bold text-white outline-none focus:border-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowArucoLayoutModal(true)}
                    className="h-9 rounded-lg border border-zinc-700 bg-zinc-800 px-2 text-xs font-black text-white"
                  >
                    ArUco Layout
                  </button>
                  <input
                    value={newCalibrationStartTrimPercent}
                    onChange={(event) => setNewCalibrationStartTrimPercent(event.target.value)}
                    placeholder="Start trim %"
                    className="h-9 rounded-lg border border-zinc-700 bg-black px-2 text-xs font-bold text-white outline-none focus:border-white"
                  />
                  <input
                    value={newCalibrationEndTrimPercent}
                    onChange={(event) => setNewCalibrationEndTrimPercent(event.target.value)}
                    placeholder="End trim %"
                    className="h-9 rounded-lg border border-zinc-700 bg-black px-2 text-xs font-bold text-white outline-none focus:border-white"
                  />
                  <div className="rounded-lg border border-zinc-800 bg-black px-2 py-2 text-[11px] font-bold text-zinc-400">
                    {selectedCapture ? 'Uses selected photo as calibration image' : 'Select a photo to link calibration image'}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={createCalibrationProfile}
                  disabled={busy || !station || !newCalibrationName.trim()}
                  className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                >
                  Add Calibration Profile
                </button>
              </div>

              <div className="mt-3 space-y-2">
                {calibrationProfiles.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-zinc-700 p-3 text-center text-xs font-bold text-zinc-500">
                    No calibration profiles yet.
                  </p>
                ) : (
                  calibrationProfiles.map((profile) => {
                    const source = Array.isArray(profile.source) ? profile.source[0] : profile.source
                    const reference = profile.measured_reference || {}
                    const markerDistances = reference.aruco_marker_distances_mm || {}
                    const calibration = profile.calibration_data || {}
                    return (
                      <div key={profile.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black">{profile.name}</p>
                            <p className="mt-1 text-xs font-bold text-zinc-500">
                              {profileTypeLabel(profile.profile_type)}
                              {source?.name ? ` - ${source.name}` : ' - station default'}
                            </p>
                            {reference.calibration_capture_id && (
                              <p className="mt-1 text-[11px] font-bold text-zinc-600">
                                Calibration image linked
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              updateCalibrationProfile(profile, {
                                status: profile.status === 'active' ? 'disabled' : 'active',
                              })
                            }
                            disabled={busy}
                            className={`shrink-0 rounded px-2 py-1 text-[10px] font-black text-white disabled:opacity-50 ${
                              profile.status === 'active' ? 'bg-green-600' : 'bg-zinc-700'
                            }`}
                          >
                            {profile.status === 'active' ? 'ACTIVE' : 'OFF'}
                          </button>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2">
                          {[
                            ['board_width_mm', 'Board W mm', 'measured_reference'],
                            ['board_height_mm', 'Board H mm', 'measured_reference'],
                            ['aruco_marker_size_mm', 'Marker mm', 'measured_reference'],
                            ['measurement_start_trim_percent', 'Start trim %', 'calibration_data'],
                            ['measurement_end_trim_percent', 'End trim %', 'calibration_data'],
                          ].map(([key, label, target]) => (
                            <label key={key} className="block">
                              <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-zinc-500">
                                {label}
                              </span>
                              <input
                                defaultValue={target === 'measured_reference' ? reference[key] || '' : calibration[key] || ''}
                                onBlur={(event) => {
                                  const nextValue = numberOrNull(event.target.value)
                                  if (target === 'measured_reference') {
                                    updateCalibrationProfile(profile, {
                                      measured_reference: {
                                        ...reference,
                                        [key]: nextValue,
                                      },
                                    })
                                  } else {
                                    updateCalibrationProfile(profile, {
                                      calibration_data: {
                                        ...calibration,
                                        [key]: nextValue,
                                      },
                                    })
                                  }
                                }}
                                className="h-8 w-full rounded border border-zinc-800 bg-black px-2 text-xs font-bold text-white outline-none focus:border-white"
                              />
                            </label>
                          ))}

                          {[
                            ['top_left_to_top_right', 'TL to TR mm'],
                            ['top_right_to_bottom_right', 'TR to BR mm'],
                            ['bottom_left_to_bottom_right', 'BL to BR mm'],
                            ['top_left_to_bottom_left', 'TL to BL mm'],
                          ].map(([key, label]) => (
                            <label key={key} className="block">
                              <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-zinc-500">
                                {label}
                              </span>
                              <input
                                defaultValue={markerDistances[key] || ''}
                                onBlur={(event) =>
                                  updateCalibrationProfile(profile, {
                                    measured_reference: {
                                      ...reference,
                                      aruco_marker_distances_mm: {
                                        ...markerDistances,
                                        [key]: numberOrNull(event.target.value),
                                      },
                                    },
                                  })
                                }
                                className="h-8 w-full rounded border border-zinc-800 bg-black px-2 text-xs font-bold text-white outline-none focus:border-white"
                              />
                            </label>
                          ))}

                          <label className="block">
                            <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-zinc-500">
                              Calibrite chart
                            </span>
                            <select
                              defaultValue={reference.calibrite_chart || 'calibrite_colorchecker_classic'}
                              onChange={(event) =>
                                updateCalibrationProfile(profile, {
                                  measured_reference: {
                                    ...reference,
                                    calibrite_chart: event.target.value,
                                  },
                                })
                              }
                              className="h-8 w-full rounded border border-zinc-800 bg-black px-2 text-xs font-bold text-white outline-none focus:border-white"
                            >
                              <option value="calibrite_colorchecker_classic">Classic</option>
                              <option value="calibrite_colorchecker_passport">Passport</option>
                              <option value="calibrite_digital_sg">Digital SG</option>
                            </select>
                          </label>
                        </div>

                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              updateCalibrationProfile(profile, {
                                measured_reference: {
                                  ...reference,
                                  calibration_capture_id: selectedCapture?.id || null,
                                },
                              })
                            }
                            disabled={busy || !selectedCapture}
                            className="rounded border border-zinc-700 px-2 py-1 text-[10px] font-black text-zinc-200 disabled:opacity-50"
                          >
                            Use Selected Photo
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateCalibrationProfile(profile, {
                                measured_reference: {
                                  ...reference,
                                  calibration_capture_id: null,
                                },
                              })
                            }
                            disabled={busy || !reference.calibration_capture_id}
                            className="rounded border border-zinc-700 px-2 py-1 text-[10px] font-black text-zinc-200 disabled:opacity-50"
                          >
                            Clear Photo
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            <div className="hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black">Sources</h2>
                  <p className="text-xs font-bold text-zinc-400">
                    Source tokens are for local workers and are shown once.
                  </p>
                </div>

                <a
                  href="http://127.0.0.1:8780/"
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-lg bg-white px-3 py-2 text-xs font-black text-black"
                  title="Open the local photo worker setup page on this PC"
                >
                  Worker Setup
                </a>
              </div>

              <p className="mb-3 rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-[11px] font-bold text-zinc-500">
                To get a source token, enter a source name such as Camera Folder 1 and click Add.
                The token appears once, then Worker Setup opens the local folder setup page with that token.
              </p>

              <div className="flex gap-2">
                <input
                  value={newSourceName}
                  onChange={(event) => setNewSourceName(event.target.value)}
                  placeholder="Source name"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-black px-3 text-xs font-bold text-white outline-none focus:border-white"
                />
                <button
                  type="button"
                  onClick={createPhotoSource}
                  disabled={busy || !newSourceName.trim() || !station}
                  className="h-9 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white disabled:opacity-50"
                >
                  Add
                </button>
              </div>

              {newSourceToken && (
                <div className="mt-3 rounded-lg border border-yellow-700 bg-yellow-950 p-3">
                  <p className="text-xs font-black text-yellow-200">Copy this token now</p>
                  <code className="mt-2 block break-all text-xs text-yellow-100">{newSourceToken}</code>
                  {newSourceSetupUrl && (
                    <a
                      href={newSourceSetupUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex rounded-lg bg-white px-3 py-2 text-xs font-black text-black"
                    >
                      Open Worker Setup With Token
                    </a>
                  )}
                </div>
              )}

              <div className="mt-3 space-y-2">
                {sources.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-zinc-700 p-3 text-center text-xs font-bold text-zinc-500">
                    No sources yet. Add one above to create the worker token.
                  </p>
                ) : (
                  sources.map((source) => (
                    <div key={source.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-black">{source.name}</p>
                          <p className="mt-1 text-xs font-bold text-zinc-500">
                            Last activity: {formatShortDateTime(source.last_activity_at)}
                          </p>
                          <label className="mt-3 block text-[10px] font-black uppercase tracking-wide text-zinc-500">
                            Source file policy
                            <select
                              value={source.source_file_policy || 'keep_source_file'}
                              onChange={(event) =>
                                updatePhotoSource(source, { source_file_policy: event.target.value })
                              }
                              disabled={busy}
                              className="mt-1 h-9 w-full rounded-lg border border-zinc-700 bg-black px-2 text-xs font-bold normal-case tracking-normal text-white outline-none focus:border-white disabled:opacity-50"
                            >
                              <option value="keep_source_file">Keep source file</option>
                              <option value="move_to_processed">Move to processed</option>
                              <option value="delete_source_when_product_photo_deleted">Delete when product photo deleted</option>
                              <option value="move_source_to_trash_when_product_photo_deleted">Move to trash when product photo deleted</option>
                            </select>
                          </label>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => updatePhotoSource(source, { enabled: !source.enabled })}
                              disabled={busy}
                              className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                            >
                              {source.enabled ? 'Disable' : 'Enable'}
                            </button>
                            <button
                              type="button"
                              onClick={() => updatePhotoSource(source, { action: 'rotate_token' })}
                              disabled={busy}
                              className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                            >
                              Rotate Token
                            </button>
                          </div>
                        </div>
                        <span
                          className={`rounded-full px-2 py-1 text-[10px] font-black ${
                            source.enabled && !source.token_revoked_at
                              ? 'bg-green-600 text-white'
                              : 'bg-zinc-700 text-zinc-300'
                          }`}
                        >
                          {source.enabled && !source.token_revoked_at ? 'ACTIVE' : 'OFF'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-bold text-zinc-500">
                        {source.source_type} · token ****{source.token_last_four || 'none'}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>

          <div className="order-1 flex min-h-0 items-center justify-center overflow-hidden rounded-2xl border border-zinc-800 bg-black lg:order-2">
            {displayUrl ? (
              <img
                src={displayUrl}
                alt="Current product photo"
                className="max-h-full w-full object-contain"
              />
            ) : (
              <div className="text-center">
                <p className="text-3xl font-black text-zinc-300">Waiting for photo</p>
                <p className="mt-2 text-sm font-bold text-zinc-500">
                  Start a session from Edit SKU, then upload or ingest photos.
                </p>
              </div>
            )}
          </div>
        </section>
      </main>
    </StaffPermissionGate>
  )
}
