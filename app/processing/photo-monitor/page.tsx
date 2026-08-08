'use client'

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
  source_id?: string | null
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
  created_at?: string | null
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
  local_reference?: {
    watch_folder?: string | null
    processed_folder?: string | null
    trash_folder?: string | null
    station_agent_source?: boolean | null
  } | null
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
  updated_at?: string | null
  source?: any
}

type PhotoProcessingJob = {
  id: string
  capture_id: string
  session_id?: string | null
  job_type: string
  status: string
  processing_source: string
  options?: Record<string, any> | null
  calibration_profile_ids?: string[] | null
  error_message?: string | null
  queued_at?: string | null
  started_at?: string | null
  completed_at?: string | null
  result_representation_id?: string | null
  result_representation?: any
}

type PhotoViewMode = 'original' | 'calibrated' | 'processed' | 'background'
const viewableRepresentationStatuses = new Set(['available', 'preview', 'accepted'])

type CropRotateSettings = {
  mode: 'auto' | 'centre'
  whitespace_percent: number
  rotation_degrees: number
  skip_closeups: boolean
  closeup_threshold: number
}

type ManualCropSettings = {
  auto_crop: boolean
  rotation_degrees: number
  zoom_percent: number
  offset_x_percent: number
  offset_y_percent: number
  crop_width_percent: number
  crop_center_x_percent: number
  crop_center_y_percent: number
  crop_left_percent: number
  crop_right_percent: number
  crop_top_percent: number
  crop_bottom_percent: number
}

type BackgroundRemovalSettings = {
  model: 'isnet-general-use' | 'u2net' | 'u2netp' | 'silueta'
  alpha_matting: boolean
  foreground_threshold: number
  background_threshold: number
  erode_size: number
  post_process_mask: boolean
  skip_full_frame: boolean
  full_frame_threshold: number
}

const defaultBackgroundRemovalSettings: BackgroundRemovalSettings = {
  model: 'isnet-general-use',
  alpha_matting: true,
  foreground_threshold: 240,
  background_threshold: 10,
  erode_size: 10,
  post_process_mask: true,
  skip_full_frame: true,
  full_frame_threshold: 94,
}

const defaultCropRotateSettings: CropRotateSettings = {
  mode: 'auto',
  whitespace_percent: 8,
  rotation_degrees: 0,
  skip_closeups: true,
  closeup_threshold: 90,
}

const defaultManualCropSettings: ManualCropSettings = {
  auto_crop: false,
  rotation_degrees: 0,
  zoom_percent: 100,
  offset_x_percent: 0,
  offset_y_percent: 0,
  crop_width_percent: 100,
  crop_center_x_percent: 0,
  crop_center_y_percent: 0,
  crop_left_percent: 0,
  crop_right_percent: 0,
  crop_top_percent: 0,
  crop_bottom_percent: 0,
}

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

function originalImageUrl(image: ItemImage | null) {
  return image?.original_url || image?.processed_url || ''
}

function sourceIsUsable(source: PhotoSource) {
  return source.enabled && !source.token_revoked_at && Boolean(source.token_last_four)
}

function phoneSourceIsConnected(source: PhotoSource) {
  if (source.source_type !== 'phone' || !sourceIsUsable(source)) return false
  const lastActivityAt = source.last_activity_at ? new Date(source.last_activity_at).getTime() : 0
  return Boolean(lastActivityAt && Date.now() - lastActivityAt <= 3 * 60 * 1000)
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
    station_daily_reference: 'Session Calibration Reference',
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
  const [monitorItemId, setMonitorItemId] = useState('')
  const [images, setImages] = useState<ItemImage[]>([])
  const [captures, setCaptures] = useState<PhotoCapture[]>([])
  const [representations, setRepresentations] = useState<CaptureRepresentation[]>([])
  const [processingJobs, setProcessingJobs] = useState<PhotoProcessingJob[]>([])
  const [sessionProcessingJobs, setSessionProcessingJobs] = useState<PhotoProcessingJob[]>([])
  const [sessionRepresentations, setSessionRepresentations] = useState<CaptureRepresentation[]>([])
  const [unassignedCaptures, setUnassignedCaptures] = useState<PhotoCapture[]>([])
  const [sources, setSources] = useState<PhotoSource[]>([])
  const [calibrationProfiles, setCalibrationProfiles] = useState<CalibrationProfile[]>([])
  const [sessionHistory, setSessionHistory] = useState<PhotoSessionHistory[]>([])
  const [selectedImageId, setSelectedImageId] = useState('')
  const [batchSelectedImageIds, setBatchSelectedImageIds] = useState<string[]>([])
  const [batchRunCalibration, setBatchRunCalibration] = useState(false)
  const [batchRunBackgroundRemoval, setBatchRunBackgroundRemoval] = useState(false)
  const [batchRunAutoCropRotate, setBatchRunAutoCropRotate] = useState(false)
  const [autoMeasureOnComplete, setAutoMeasureOnComplete] = useState(false)
  const [completionWorkflowOpen, setCompletionWorkflowOpen] = useState(false)
  const [completionWorkflowStage, setCompletionWorkflowStage] = useState<'measure' | 'processing' | 'preview'>('processing')
  const [completionJobIds, setCompletionJobIds] = useState<string[]>([])
  const [completionTargetCaptureIds, setCompletionTargetCaptureIds] = useState<string[]>([])
  const [completionRunStartedAt, setCompletionRunStartedAt] = useState<string | null>(null)
  const [completionCanUseExistingPreviews, setCompletionCanUseExistingPreviews] = useState(true)
  const [completionBackgroundImageIds, setCompletionBackgroundImageIds] = useState<string[]>([])
  const [completionCropSettingsByImageId, setCompletionCropSettingsByImageId] = useState<Record<string, ManualCropSettings>>({})
  const [showStationSettings, setShowStationSettings] = useState(false)
  const [calibrationPromptOpen, setCalibrationPromptOpen] = useState(false)
  const [calibrationCapturePending, setCalibrationCapturePending] = useState(false)
  const [autoPreviewNewest, setAutoPreviewNewest] = useState(true)
  const [viewMode, setViewMode] = useState<PhotoViewMode>('original')
  const [showMeasurements, setShowMeasurements] = useState(false)
  const [processingSettingsOpen, setProcessingSettingsOpen] = useState<null | 'measure' | 'calibration' | 'crop_rotate' | 'background'>(null)
  const [backgroundRemovalSettings, setBackgroundRemovalSettings] = useState<BackgroundRemovalSettings>(
    defaultBackgroundRemovalSettings
  )
  const [cropRotateSettings, setCropRotateSettings] = useState<CropRotateSettings>(defaultCropRotateSettings)
  const [aiComparisonOpen, setAiComparisonOpen] = useState(false)
  const [qcNotes, setQcNotes] = useState('')
  const [newStationName, setNewStationName] = useState('')
  const [editingStationName, setEditingStationName] = useState('')
  const [newSourceName, setNewSourceName] = useState('')
  const [newCalibrationName, setNewCalibrationName] = useState('')
  const [newCalibrationType, setNewCalibrationType] = useState('station_daily_reference')
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
  const phonePairHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const transientMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setStationId(params.get('station') || '')
    setMonitorItemId(params.get('item_id') || '')
    if (params.get('calibration_prompt') === '1') {
      setCalibrationPromptOpen(true)
      params.delete('calibration_prompt')
      const nextQuery = params.toString()
      window.history.replaceState(null, '', `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`)
    }
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
    return () => {
      if (transientMessageTimerRef.current) clearTimeout(transientMessageTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!stationId && station?.id) {
      setStationId(station.id)
    }
  }, [station?.id, stationId])

  useEffect(() => {
    fetchImages()
    fetchCaptures()
    fetchUnassignedCaptures()
    fetchSessionProcessingJobs(false)
    fetchSessionRepresentations(false)
  }, [session?.item_id, activeCompanyId, schemaReady, station?.id])

  useEffect(() => {
    fetchSources()
    fetchCalibrationProfiles()
    fetchSessionHistory()
  }, [station?.id, activeCompanyId, schemaReady])

  useEffect(() => {
    if (!station?.id) return
    const timer = window.setInterval(() => fetchSources(false), 60 * 1000)
    return () => window.clearInterval(timer)
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
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'photo_sources',
          filter: `company_id=eq.${activeCompanyId}`,
        },
        () => fetchSources(false)
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
        () => {
          fetchProcessingJobs(false)
          fetchSessionProcessingJobs(false)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeCompanyId, schemaReady, session?.id, selectedImageId])

  useEffect(() => {
    if (!schemaReady || !activeCompanyId || !station?.id) return

    const channel = supabase
      .channel(`photo-monitor-calibration-${activeCompanyId}-${station.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'photography_calibration_profiles',
          filter: `station_id=eq.${station.id}`,
        },
        () => {
          setCalibrationCapturePending(false)
          fetchCalibrationProfiles(false)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeCompanyId, schemaReady, station?.id])

  useEffect(() => {
    if (!schemaReady || !activeCompanyId || !session?.id) return

    const channel = supabase
      .channel(`photo-monitor-representations-${activeCompanyId}-${session.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'photo_capture_representations',
          filter: `session_id=eq.${session.id}`,
        },
        () => {
          fetchRepresentations(false)
          fetchSessionRepresentations(false)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeCompanyId, schemaReady, session?.id, selectedImageId])

  useEffect(() => {
    if (!completionWorkflowOpen || completionWorkflowStage !== 'preview' || !session?.id) return

    fetchSessionProcessingJobs(false)
    fetchSessionRepresentations(false)

    const timer = window.setInterval(() => {
      fetchProcessingJobs(false)
      fetchRepresentations(false)
      fetchSessionProcessingJobs(false)
      fetchSessionRepresentations(false)
    }, 1500)

    return () => window.clearInterval(timer)
  }, [completionWorkflowOpen, completionWorkflowStage, session?.id, selectedImageId])

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
  const selectedPreviewImageIndex = selectedImage?.id
    ? thumbnailImages.findIndex((image) => image.id === selectedImage.id)
    : -1
  const selectedPreviewImagePosition = selectedPreviewImageIndex >= 0 ? selectedPreviewImageIndex + 1 : 0

  function moveSelectedPreviewImage(direction: -1 | 1) {
    if (!thumbnailImages.length) return
    const currentIndex = selectedPreviewImageIndex >= 0 ? selectedPreviewImageIndex : 0
    const nextIndex = Math.max(0, Math.min(thumbnailImages.length - 1, currentIndex + direction))
    const nextImage = thumbnailImages[nextIndex]
    if (nextImage?.id) setSelectedImageId(nextImage.id)
  }

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
      .select('id, source_id, item_image_id, item_id, session_id, assignment_method, capture_status, original_filename, received_at, exif')
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

  async function fetchSessionProcessingJobs(showErrors = true) {
    if (!session?.id) {
      setSessionProcessingJobs([])
      return
    }

    try {
      const response = await fetch(
        `/api/photography/processing-jobs?session_id=${encodeURIComponent(session.id)}`
      )
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not load session processing jobs.')
      }

      setSessionProcessingJobs(data.jobs || [])
    } catch (error: any) {
      if (showErrors) setMessage(error.message || 'Could not load session processing jobs.')
    }
  }

  async function fetchSessionRepresentations(showErrors = true) {
    if (!session?.id) {
      setSessionRepresentations([])
      return
    }

    try {
      const response = await fetch(
        `/api/photography/captures/representations?session_id=${encodeURIComponent(session.id)}`
      )
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not load session preview images.')
      }

      setSessionRepresentations(data.representations || [])
    } catch (error: any) {
      if (showErrors) setMessage(error.message || 'Could not load session preview images.')
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

  async function deletePhotoSource(source: PhotoSource) {
    const confirmed = window.confirm(`Remove photo source "${source.name}" from this station?`)
    if (!confirmed) return

    setBusy(true)
    setMessage('')

    try {
      const response = await fetch(`/api/photography/sources?id=${encodeURIComponent(source.id)}`, {
        method: 'DELETE',
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not remove photo source.')
      }

      await fetchSources(false)
      setMessage('Photo source removed.')
    } catch (error: any) {
      setMessage(error.message || 'Could not remove photo source.')
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
        calibration_image_url: selectedImage?.original_url || selectedImage?.processed_url || null,
        reference_scope:
          newCalibrationType === 'station_daily_reference'
            ? ['colour', 'geometry', 'measurements', 'background', 'crop']
            : undefined,
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
        captured_for_date: new Date().toISOString().slice(0, 10),
        background_reference:
          newCalibrationType === 'station_daily_reference'
            ? {
                enabled: true,
                sample_method: 'calibration_image_background_estimate',
                note: 'Processor should estimate the clean background from this calibration image before matting product photos.',
              }
            : undefined,
        measurement_start_trim_percent: numberOrNull(newCalibrationStartTrimPercent),
        measurement_end_trim_percent: numberOrNull(newCalibrationEndTrimPercent),
        notes:
          newCalibrationType === 'station_daily_reference'
            ? 'Session calibration reference for colour, ArUco geometry, measurement scale, background removal and crop guidance.'
            : 'Stored calibration inputs only. Image processor must generate transforms before calibrated previews or measurements use them.',
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

  async function saveSelectedAsDailyReference() {
    if (!station?.id || !selectedCapture?.id) {
      setMessage('Select the calibration photo first.')
      return
    }

    setBusy(true)
    setMessage('')

    const existing = activeDailyReferenceProfile()
    const measuredReference = {
      ...(existing?.measured_reference || {}),
      calibration_capture_id: selectedCapture.id,
      calibration_image_url: selectedImage?.original_url || selectedImage?.processed_url || null,
      reference_scope: ['colour', 'geometry', 'measurements', 'background', 'crop'],
    }
    const calibrationData = {
      ...(existing?.calibration_data || {}),
      captured_for_date: new Date().toISOString().slice(0, 10),
      background_reference: {
        enabled: true,
        sample_method: 'calibration_image_background_estimate',
        note: 'Processor should estimate the clean background from this calibration image before matting product photos.',
      },
      notes: 'Session calibration reference for colour, ArUco geometry, measurement scale, background removal and crop guidance.',
    }

    try {
      const response = await fetch('/api/photography/calibration-profiles', {
        method: existing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          existing
            ? {
                id: existing.id,
                name: existing.name || `Session reference ${new Date().toLocaleDateString('en-GB')}`,
                measured_reference: measuredReference,
                calibration_data: calibrationData,
                status: 'active',
              }
            : {
                station_id: station.id,
                source_id: selectedCapture.source_id || null,
                name: `Session reference ${new Date().toLocaleDateString('en-GB')}`,
                profile_type: 'station_daily_reference',
                measured_reference: measuredReference,
                calibration_data: calibrationData,
              }
        ),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not save calibration image.')
      }

      await fetchCalibrationProfiles(false)
      setMessage('Calibration image saved.')
    } catch (error: any) {
      setMessage(error.message || 'Could not save calibration image.')
    } finally {
      setBusy(false)
    }
  }

  async function requestStationCalibrationCapture() {
    if (!station?.id) {
      setMessage('Select a station first.')
      return
    }

    setBusy(true)
    setMessage('')

    try {
      const response = await fetch('/api/photography/calibration-capture-intents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          station_id: station.id,
          staff_id: staff?.id || null,
        }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not prepare calibration capture.')
      }

      setCalibrationCapturePending(true)
      setCalibrationPromptOpen(false)
      setMessage('Take the calibration image now. The next station photo will update calibration only, not the SKU photos.')
    } catch (error: any) {
      setMessage(error.message || 'Could not prepare calibration capture.')
    } finally {
      setBusy(false)
    }
  }

  async function queueProcessingJob(
    jobType: 'calibrated_preview' | 'measurement_analysis' | 'background_removal' | 'processed_preview' | 'raw_development'
  ) {
    if (!selectedImageId) {
      setMessage('Select a session photo before queueing processing.')
      return
    }

    setBusy(true)
    setMessage('')

    try {
      const linkedCapture = await ensureCaptureForImage(selectedImageId)
      await fetchCaptures(false)
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
          options:
            jobType === 'background_removal'
              ? {
                  background_removal: {
                    ...backgroundRemovalSettings,
                    station_daily_reference_profile_id: activeDailyReferenceProfile()?.id || null,
                  },
                }
              : jobType === 'processed_preview'
                ? {
                    crop_rotate: {
                      ...cropRotateSettings,
                      station_daily_reference_profile_id: activeDailyReferenceProfile()?.id || null,
                    },
                  }
                : undefined,
        }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not queue processing job.')
      }

      await fetchProcessingJobs(false)
      if (jobType === 'background_removal') setViewMode('background')
      setMessage(data.already_queued ? data.message : `${processingJobLabel(jobType)} queued.`)
    } catch (error: any) {
      setMessage(error.message || 'Could not queue processing job.')
    } finally {
      setBusy(false)
    }
  }

  async function queueProcessingJobForCapture(
    captureId: string,
    jobType: 'calibrated_preview' | 'measurement_analysis' | 'background_removal' | 'processed_preview' | 'raw_development',
    force = false
  ) {
    const response = await fetch('/api/photography/processing-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        capture_id: captureId,
        job_type: jobType,
        force,
        processing_source: 'jpeg_camera_original',
        calibration_profile_ids: calibrationProfiles
          .filter((profile) => profile.status === 'active')
          .map((profile) => profile.id),
        options: {
          requested_from: 'photo_monitor_batch_pipeline',
          ...(jobType === 'background_removal'
            ? {
                background_removal: {
                  ...backgroundRemovalSettings,
                  station_daily_reference_profile_id: activeDailyReferenceProfile()?.id || null,
                },
              }
            : {}),
          ...(jobType === 'processed_preview'
            ? {
                crop_rotate: {
                  ...cropRotateSettings,
                  station_daily_reference_profile_id: activeDailyReferenceProfile()?.id || null,
                },
              }
            : {}),
        },
      }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || !data?.ok) {
      throw new Error(data?.message || `Could not queue ${processingJobLabel(jobType)}.`)
    }
    return data
  }

  function activeDailyReferenceProfile() {
    return calibrationProfiles.find((profile) => {
      const reference = profile.measured_reference || {}
      return (
        profile.status === 'active' &&
        profile.profile_type === 'station_daily_reference' &&
        Boolean(reference.calibration_capture_id || reference.calibration_image_url)
      )
    }) || null
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

  async function ensureCaptureForImage(imageId: string) {
    const existing = captureByImageId.get(imageId)
    const existingHasManualFallback = Boolean(
      existing?.source_id && (existing.exif?.public_url || existing.exif?.original_url || existing.exif?.processed_url)
    )
    const shouldRefreshExisting =
      Boolean(existing?.id) &&
      (existing?.assignment_method === 'explicit_session' || existing?.exif?.manual_upload || !existingHasManualFallback)

    if (existing?.id && !shouldRefreshExisting) return existing
    if (!session?.item_id) throw new Error('Active photo session is required.')

    const image = images.find((row) => row.id === imageId)
    const response = await fetch('/api/photography/captures/attach-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        item_id: session.item_id,
        item_image_id: imageId,
        original_filename: image?.original_url?.split('/').pop()?.split('?')[0] || 'manual-upload.jpg',
      }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || !data?.ok) {
      throw new Error(data?.message || 'Could not link uploaded image to this photo session.')
    }
    if (!data.attached || !data.capture?.id) {
      throw new Error('Could not link uploaded image to this photo session.')
    }
    await fetchSessionRepresentations(false)
    return data.capture as PhotoCapture
  }

  async function runBatchPreviewPipeline(options: { force?: boolean } = {}) {
    const force = Boolean(options.force)
    const targetImageIds = batchTargetImageIds()
    if (targetImageIds.length === 0) {
      setMessage('Add photos before running the batch pipeline.')
      return false
    }
    if (!batchRunCalibration && !batchRunBackgroundRemoval && !batchRunAutoCropRotate) {
      setMessage('Choose at least one batch processing step.')
      return false
    }
    if ((autoMeasureOnComplete || batchRunCalibration || batchRunAutoCropRotate || batchRunBackgroundRemoval) && !activeDailyReferenceProfile()) {
      setMessage('No calibration image selected for this session.')
    }

    setBusy(true)
    setMessage('')

    try {
      const previewRunStartedAt = new Date(Date.now() - 1000).toISOString()
      const targetViewMode: PhotoViewMode = batchRunBackgroundRemoval
        ? 'background'
        : batchRunAutoCropRotate
          ? 'processed'
          : batchRunCalibration
            ? 'calibrated'
            : 'original'
      const targetCaptures: PhotoCapture[] = []
      for (const imageId of targetImageIds) {
        targetCaptures.push(await ensureCaptureForImage(imageId))
      }

      if (targetCaptures.length === 0) {
        setMessage('The selected photos are not linked to station captures yet.')
        return false
      }

      await fetchCaptures(false)

      let queued = 0
      const queuedJobIds: string[] = []
      for (const capture of targetCaptures) {
        if (!force && targetViewMode !== 'original' && representationForMode(capture.id, targetViewMode)) {
          continue
        }

        if (batchRunCalibration) {
          const data = await queueProcessingJobForCapture(capture.id, 'calibrated_preview', force)
          if (data?.job?.id) queuedJobIds.push(data.job.id)
          queued += 1
        }
        if (batchRunAutoCropRotate) {
          const data = await queueProcessingJobForCapture(capture.id, 'processed_preview', force)
          if (data?.job?.id) queuedJobIds.push(data.job.id)
          queued += 1
        }
        if (batchRunBackgroundRemoval) {
          const data = await queueProcessingJobForCapture(capture.id, 'background_removal', force)
          if (data?.job?.id) queuedJobIds.push(data.job.id)
          queued += 1
        }
      }

      await fetchProcessingJobs(false)
      await fetchSessionProcessingJobs(false)
      await fetchSessionRepresentations(false)
      setCompletionJobIds(queuedJobIds)
      setCompletionTargetCaptureIds(targetCaptures.map((capture) => capture.id))
      setCompletionRunStartedAt(previewRunStartedAt)
      setCompletionCanUseExistingPreviews(!force)
      setCompletionBackgroundImageIds(
        batchRunBackgroundRemoval
          ? targetCaptures.map((capture) => capture.item_image_id).filter((id): id is string => Boolean(id))
          : []
      )
      if (batchRunBackgroundRemoval) {
        setViewMode('background')
      } else if (batchRunAutoCropRotate) {
        setViewMode('processed')
      } else if (batchRunCalibration) {
        setViewMode('calibrated')
      }
      setMessage(
        queued
          ? `${queued} batch preview job${queued === 1 ? '' : 's'} queued. Waiting for worker output.`
          : force
            ? 'No new preview jobs were queued.'
            : 'Existing processed previews are ready to review.'
      )
      return true
    } catch (error: any) {
      setMessage(error.message || 'Could not queue batch preview pipeline.')
      return false
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
      const representationsByCapture = new Map<string, CaptureRepresentation[]>()
      for (const capture of targetCaptures) {
        const response = await fetch(
          `/api/photography/captures/representations?capture_id=${encodeURIComponent(capture.id)}`
        )
        const data = await response.json().catch(() => null)
        if (!response.ok || !data?.ok) {
          throw new Error(data?.message || 'Could not load batch preview results.')
        }
        representationsByCapture.set(capture.id, data.representations || [])
      }

      const preferredTypes = [
        batchRunAutoCropRotate ? 'processed_preview' : '',
        batchRunCalibration ? 'calibrated_preview' : '',
        'processed_preview',
        'calibrated_preview',
      ].filter(Boolean)

      let applied = 0
      let keptOriginal = 0
      const missing: string[] = []

      for (const capture of targetCaptures) {
        const imageId = capture.item_image_id || ''
        const useBackground = imageId ? completionBackgroundImageIds.includes(imageId) : false
        const manualCropSettings = cropSettingsForImage(imageId)
        const manualOriginalSelected =
          imageId &&
          !useBackground &&
          batchRunAutoCropRotate &&
          !manualCropSettings.auto_crop &&
          !hasManualCropChanges(manualCropSettings)
        let manualCropRepresentation: CaptureRepresentation | null = null
        if (
          imageId &&
          !useBackground &&
          batchRunAutoCropRotate &&
          !manualCropSettings.auto_crop &&
          hasManualCropChanges(manualCropSettings)
        ) {
          const cropResponse = await fetch('/api/photography/captures/representations', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              action: 'create_manual_crop_preview',
              capture_id: capture.id,
              item_image_id: imageId,
              settings: manualCropSettings,
            }),
          })
          const cropData = await cropResponse.json().catch(() => null)
          if (!cropResponse.ok || !cropData?.ok) {
            throw new Error(cropData?.message || 'Could not create manual crop preview.')
          }
          manualCropRepresentation = cropData.representation || null
        }

        if (manualOriginalSelected) {
          const image = images.find((row) => row.id === imageId)
          const originalUrl = originalImageUrl(image || null)
          if (originalUrl) {
            const { error: resetError } = await supabase
              .from('item_images')
              .update({ processed_url: originalUrl })
              .eq('company_id', activeCompanyId)
              .eq('id', imageId)

            if (resetError) throw resetError
            keptOriginal += 1
            continue
          }
        }

        const selectedRepresentation =
          manualCropRepresentation ||
          (useBackground
            ? completionRepresentationForMode(capture.id, 'background')
            : batchRunAutoCropRotate
              ? completionRepresentationForMode(capture.id, 'processed')
              : batchRunCalibration
                ? completionRepresentationForMode(capture.id, 'calibrated')
                : null)

        if (!selectedRepresentation && !preferredTypes.length) {
          keptOriginal += 1
          continue
        }

        const rows = representationsByCapture.get(capture.id) || []
        const representation = selectedRepresentation || preferredTypes
          .map((type) =>
            rows
              .filter((row) => row.representation_type === type && viewableRepresentationStatuses.has(row.status) && row.public_url)
              .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0]
          )
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
          ? `${applied} processed image${applied === 1 ? '' : 's'} accepted. ${keptOriginal} kept original. ${missing.length} had no completed preview yet.`
          : `${applied} processed image${applied === 1 ? '' : 's'} accepted. ${keptOriginal} kept original.`
      )
    } catch (error: any) {
      setMessage(error.message || 'Could not accept batch preview.')
    } finally {
      setBusy(false)
    }
  }

  async function revertBatchPreviewPipeline() {
    setViewMode('original')
    if (session?.id || completionTargetCaptureIds.length > 0) {
      await fetch('/api/photography/preview-cleanup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session_id: session?.id || null,
          capture_ids: completionTargetCaptureIds,
        }),
      }).catch(() => null)
      await fetchSessionRepresentations(false)
      await fetchRepresentations(false)
    }
    setTimedMessage('Batch preview reverted. Nothing was applied to the item images.', 4000)
  }

  function setTimedMessage(nextMessage: string, timeoutMs = 4000) {
    if (transientMessageTimerRef.current) clearTimeout(transientMessageTimerRef.current)
    setMessage(nextMessage)
    transientMessageTimerRef.current = setTimeout(() => {
      setMessage((current) => (current === nextMessage ? '' : current))
    }, timeoutMs)
  }

  function updateBackgroundRemovalSettings(patch: Partial<BackgroundRemovalSettings>) {
    setBackgroundRemovalSettings((current) => ({ ...current, ...patch }))
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
      const appOrigin =
        typeof window !== 'undefined' &&
        /^https?:\/\//i.test(window.location.origin) &&
        !['null', 'undefined'].includes(window.location.origin)
          ? window.location.origin
          : ''
      const response = await fetch('/api/photography/phone-pairing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          station_id: station.id,
          app_origin: appOrigin,
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

    if (images.length > 0) {
      const completeFirst = window.confirm(
        'This photo session has photos.\n\nComplete photos before ending this session?'
      )
      if (completeFirst) {
        startCompletePhotosWorkflow()
        return
      }
    }

    const confirmed = window.confirm('End the active photo session without completing photos?')
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

  async function startSessionFromMonitor() {
    if (!station?.id) return
    if (!monitorItemId) {
      setMessage('Open Photo Monitor from Edit SKU to start a session for that item.')
      return
    }

    setBusy(true)
    setMessage('Starting photo session...')

    try {
      const response = await fetch('/api/photography/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          station_id: station.id,
          item_id: monitorItemId,
          start_method: 'manual_button',
          staff_id: staff?.id || null,
        }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Photo session failed to start.')
      }

      await fetchStations(false)
      setMessage('Photo session started.')
    } catch (error: any) {
      setMessage(error.message || 'Photo session failed to start.')
    } finally {
      setBusy(false)
    }
  }

  async function completeSession(qcStatus = 'complete', skipConfirm = false) {
    if (!station?.id) return false

    const label = qcStatus === 'needs_reshoot' ? 'mark this session as needing reshoot' : 'complete this photo session'
    const confirmed = skipConfirm || window.confirm(`Are you sure you want to ${label}?`)
    if (!confirmed) return false

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
      return true
    } catch (error: any) {
      setMessage(error.message || 'Could not complete photo session.')
      return false
    } finally {
      setBusy(false)
    }
  }

  function startCompletePhotosWorkflow() {
    if (!session?.id || images.length === 0) {
      setMessage('Take at least one photo before completing.')
      return
    }
    if (!autoMeasureOnComplete && !batchRunCalibration && !batchRunAutoCropRotate && !batchRunBackgroundRemoval) {
      completeSession('complete')
      return
    }
    setCompletionWorkflowStage(autoMeasureOnComplete ? 'measure' : 'processing')
    setCompletionWorkflowOpen(true)
  }

  async function runCompletionProcessingPreview() {
    const queued = await runBatchPreviewPipeline()
    if (queued) {
      setSelectedImageId(thumbnailImages[0]?.id || images[0]?.id || '')
      setCompletionWorkflowStage('preview')
    }
  }

  async function rerunCompletionProcessingPreview() {
    const queued = await runBatchPreviewPipeline({ force: true })
    if (queued) {
      setSelectedImageId(thumbnailImages[0]?.id || images[0]?.id || '')
      setCompletionWorkflowStage('preview')
    }
  }

  async function acceptCompletionWorkflow() {
    await acceptBatchPreviewPipeline()
    setCompletionWorkflowOpen(false)
    await completeSession('complete', true)
  }

  async function revertCompletionWorkflow() {
    await revertBatchPreviewPipeline()
    setCompletionBackgroundImageIds([])
    setCompletionWorkflowOpen(false)
  }

  const currentUrl = imageUrl(selectedImage)
  const currentOriginalUrl = originalImageUrl(selectedImage)
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
  const activeViewMode: PhotoViewMode =
    viewMode === 'background' && backgroundRepresentation?.public_url
      ? 'background'
      : viewMode === 'processed' && processedRepresentation?.public_url
        ? 'processed'
        : viewMode === 'calibrated' && calibratedRepresentation?.public_url
          ? 'calibrated'
          : pipelineViewMode
  const selectedCompletionOriginal =
    completionWorkflowOpen &&
    completionWorkflowStage === 'preview' &&
    selectedImage?.id &&
    !completionImageUsesBackground(selectedImage.id) &&
    completionFallbackModeForImage(selectedImage.id) === 'original'
  const selectedCompletionMode: PhotoViewMode =
    completionWorkflowOpen && completionWorkflowStage === 'preview' && selectedImage?.id
      ? completionImageUsesBackground(selectedImage.id)
        ? 'background'
        : completionFallbackModeForImage(selectedImage.id)
      : activeViewMode
  const selectedCropSettings = cropSettingsForImage(selectedImage?.id)
  const selectedManualCropActive =
    completionWorkflowOpen &&
    completionWorkflowStage === 'preview' &&
    batchRunAutoCropRotate &&
    selectedImage?.id &&
    !selectedCropSettings.auto_crop &&
    !completionImageUsesBackground(selectedImage.id)
  const displayUrl =
    selectedCompletionOriginal
      ? currentOriginalUrl
      : selectedCompletionMode === 'background' && backgroundRepresentation?.public_url
      ? backgroundRepresentation.public_url
      : selectedCompletionMode === 'processed' && processedRepresentation?.public_url
        ? processedRepresentation.public_url
        : selectedCompletionMode === 'calibrated' && calibratedRepresentation?.public_url
        ? calibratedRepresentation.public_url
        : selectedCompletionMode === 'original'
          ? currentOriginalUrl
          : currentUrl
  const completionViewMode: PhotoViewMode = batchRunBackgroundRemoval
    ? 'background'
    : batchRunAutoCropRotate
      ? 'processed'
      : batchRunCalibration
        ? 'calibrated'
        : 'original'
  const previewBackgroundStyle =
    selectedCompletionMode === 'background'
      ? {
          backgroundColor: '#ffffff',
          backgroundImage:
            'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
          backgroundSize: '24px 24px',
          backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0px',
        }
      : undefined
  const measurementSourceCaptureId = session?.measurement_source_capture_id || null
  const selectedIsMeasurementSource =
    Boolean(selectedCapture?.id && measurementSourceCaptureId && selectedCapture.id === measurementSourceCaptureId)
  const dailyReferenceProfile = activeDailyReferenceProfile()
  const activeCalibrationCount = calibrationProfiles.filter((profile) => profile.status === 'active').length
  const activeProcessingJobs = processingJobs.filter((job) =>
    ['queued', 'waiting_for_worker', 'processing', 'uploading'].includes(job.status)
  )
  const latestCalibrationJob = processingJobs.find((job) => job.job_type === 'calibrated_preview')
  const latestMeasurementJob = processingJobs.find((job) => job.job_type === 'measurement_analysis')
  const latestBackgroundJob = processingJobs.find((job) => job.job_type === 'background_removal')
  const latestPreviewJob = processingJobs.find((job) => job.job_type === 'processed_preview')
  const latestRawJob = processingJobs.find((job) => job.job_type === 'raw_development')
  const sessionRepresentationsByCaptureId = useMemo(() => {
    const byCapture = new Map<string, CaptureRepresentation[]>()
    for (const representation of sessionRepresentations) {
      const rows = byCapture.get(representation.capture_id) || []
      rows.push(representation)
      byCapture.set(representation.capture_id, rows)
    }
    for (const representation of representations) {
      const rows = byCapture.get(representation.capture_id) || []
      if (!rows.some((row) => row.id === representation.id)) rows.push(representation)
      byCapture.set(representation.capture_id, rows)
    }
    return byCapture
  }, [sessionRepresentations, representations])
  const completionBatchJobs = completionJobIds
    .map((jobId) => sessionProcessingJobs.find((job) => job.id === jobId))
    .filter((job): job is PhotoProcessingJob => Boolean(job?.id))
  const completionTotalJobs = completionJobIds.length
  const completionLoadedJobCount = completionBatchJobs.length
  const completionMissingJobCount = Math.max(0, completionTotalJobs - completionLoadedJobCount)
  function representationForMode(captureId: string | undefined | null, mode: PhotoViewMode, minCreatedAt?: string | null) {
    if (!captureId) return null
    const rows = sessionRepresentationsByCaptureId.get(captureId) || []
    const representationType =
      mode === 'background'
        ? 'background_removed'
        : mode === 'processed'
          ? 'processed_preview'
          : mode === 'calibrated'
            ? 'calibrated_preview'
            : ''
    if (!representationType) return null
    const minTime = minCreatedAt ? new Date(minCreatedAt).getTime() : 0
    return rows
      .filter((row) => {
        if (row.representation_type !== representationType || !viewableRepresentationStatuses.has(row.status) || !row.public_url) return false
        if (!minTime) return true
        const createdTime = row.created_at ? new Date(row.created_at).getTime() : 0
        return createdTime >= minTime
      })
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null
  }
  function jobResultRepresentationForMode(captureId: string | undefined | null, mode: PhotoViewMode) {
    if (!captureId) return null
    const representationType =
      mode === 'background'
        ? 'background_removed'
        : mode === 'processed'
          ? 'processed_preview'
          : mode === 'calibrated'
            ? 'calibrated_preview'
            : ''
    if (!representationType) return null

    const completedJob = completionBatchJobs.find((job) => {
      const result = job.result_representation
      return (
        job.capture_id === captureId &&
        job.status === 'completed' &&
        result?.representation_type === representationType &&
        viewableRepresentationStatuses.has(result.status) &&
        result.public_url
      )
    })

    return completedJob?.result_representation || null
  }
  function completionRepresentationForMode(captureId: string | undefined | null, mode: PhotoViewMode) {
    return (
      jobResultRepresentationForMode(captureId, mode) ||
      representationForMode(captureId, mode, completionRunStartedAt) ||
      (completionCanUseExistingPreviews ? representationForMode(captureId, mode) : null)
    )
  }
  function cropSettingsForImage(imageId: string | undefined | null): ManualCropSettings {
    if (!imageId) return defaultManualCropSettings
    return completionCropSettingsByImageId[imageId] || defaultManualCropSettings
  }
  function updateCropSettingsForImage(imageId: string, patch: Partial<ManualCropSettings>) {
    setCompletionCropSettingsByImageId((current) => ({
      ...current,
      [imageId]: {
        ...defaultManualCropSettings,
        ...(current[imageId] || {}),
        ...patch,
      },
    }))
  }
  function hasManualCropChanges(settings: ManualCropSettings) {
    return (
      Math.abs(settings.rotation_degrees || 0) > 0 ||
      Math.abs(settings.crop_left_percent || 0) > 0 ||
      Math.abs(settings.crop_right_percent || 0) > 0 ||
      Math.abs(settings.crop_top_percent || 0) > 0 ||
      Math.abs(settings.crop_bottom_percent || 0) > 0
    )
  }
  const selectedCropLeft = Math.max(0, Math.min(80, selectedCropSettings.crop_left_percent || 0))
  const selectedCropRight = Math.max(0, Math.min(80, selectedCropSettings.crop_right_percent || 0))
  const selectedCropTop = Math.max(0, Math.min(80, selectedCropSettings.crop_top_percent || 0))
  const selectedCropBottom = Math.max(0, Math.min(80, selectedCropSettings.crop_bottom_percent || 0))
  const selectedCropHasChanges =
    hasManualCropChanges(selectedCropSettings)
  function completionFallbackModeForImage(imageId?: string | null) {
    if (batchRunAutoCropRotate && cropSettingsForImage(imageId).auto_crop) return 'processed' as PhotoViewMode
    if (batchRunCalibration) return 'calibrated' as PhotoViewMode
    return 'original' as PhotoViewMode
  }
  function completionRequiredModeForImageId(imageId: string | null | undefined) {
    if (imageId && completionBackgroundImageIds.includes(imageId)) return 'background' as PhotoViewMode
    return completionFallbackModeForImage(imageId)
  }
  function completionRequiredModeForCapture(captureId: string) {
    const capture = captures.find((row) => row.id === captureId)
    return completionRequiredModeForImageId(capture?.item_image_id)
  }
  const completionTargetCaptureSet = new Set(completionTargetCaptureIds)
  const completionCompletedCaptureIds = completionTargetCaptureIds.filter((captureId) =>
    completionRequiredModeForCapture(captureId) === 'original' ||
    Boolean(completionRepresentationForMode(captureId, completionRequiredModeForCapture(captureId)))
  )
  const completionIncompleteCaptureIds = completionTargetCaptureIds.filter(
    (captureId) => !completionCompletedCaptureIds.includes(captureId)
  )
  function completionRequiredJobTypeForCapture(captureId: string) {
    const mode = completionRequiredModeForCapture(captureId)
    return mode === 'background'
      ? 'background_removal'
      : mode === 'processed'
        ? 'processed_preview'
        : mode === 'calibrated'
          ? 'calibrated_preview'
          : ''
  }
  const completionActiveJobs = completionBatchJobs.filter(
    (job) =>
      completionTargetCaptureSet.has(job.capture_id) &&
      completionIncompleteCaptureIds.includes(job.capture_id) &&
      (!completionRequiredJobTypeForCapture(job.capture_id) || job.job_type === completionRequiredJobTypeForCapture(job.capture_id)) &&
      ['queued', 'waiting_for_worker', 'processing', 'uploading'].includes(job.status)
  )
  const completionFailedJobs = completionBatchJobs.filter(
    (job) =>
      completionTargetCaptureSet.has(job.capture_id) &&
      completionIncompleteCaptureIds.includes(job.capture_id) &&
      (!completionRequiredJobTypeForCapture(job.capture_id) || job.job_type === completionRequiredJobTypeForCapture(job.capture_id)) &&
      job.status === 'failed'
  )
  const completionCompletedJobs = completionBatchJobs.filter(
    (job) => completionTargetCaptureSet.has(job.capture_id) && job.status === 'completed'
  )
  const completionProgressUnits = Math.max(completionTargetCaptureIds.length, completionTotalJobs)
  const completionDoneUnits = completionTargetCaptureIds.length
    ? completionCompletedCaptureIds.length
    : completionCompletedJobs.length
  const completionProgressPercent =
    completionProgressUnits > 0 ? Math.round((completionDoneUnits / completionProgressUnits) * 100) : 0
  const completionPreviewReady =
    completionTargetCaptureIds.length > 0 && completionCompletedCaptureIds.length === completionTargetCaptureIds.length
  function displayUrlForImage(image: ItemImage | null) {
    if (!image?.id) return ''
    if (
      completionWorkflowOpen &&
      completionWorkflowStage === 'preview' &&
      completionTargetCaptureIds.includes(captureByImageId.get(image.id)?.id || '')
    ) {
      const mode = completionImageUsesBackground(image.id) ? 'background' : completionFallbackModeForImage(image.id)
      if (mode === 'original') return originalImageUrl(image)
      const representation = completionRepresentationForMode(captureByImageId.get(image.id)?.id, mode)
      return representation?.public_url || originalImageUrl(image)
    }
    const capture = captureByImageId.get(image.id)
    const currentRunRepresentation =
      completionWorkflowOpen && completionWorkflowStage === 'preview' && completionTargetCaptureIds.includes(capture?.id || '')
        ? completionRepresentationForMode(capture?.id, completionViewMode)
        : null
    const representation = currentRunRepresentation || representationForMode(capture?.id, activeViewMode)
    return representation?.public_url || imageUrl(image)
  }
  function completionStatusForImage(image: ItemImage) {
    const capture = captureByImageId.get(image.id)
    if (!capture?.id || !completionTargetCaptureIds.includes(capture.id)) return null
    const requiredMode = completionRequiredModeForImageId(image.id)
    if (requiredMode === 'original' || completionRepresentationForMode(capture.id, requiredMode)) return 'complete'
    const requiredJobType =
      requiredMode === 'background'
        ? 'background_removal'
        : requiredMode === 'processed'
          ? 'processed_preview'
          : requiredMode === 'calibrated'
            ? 'calibrated_preview'
            : ''
    const jobs = completionBatchJobs.filter((job) => job.capture_id === capture.id && (!requiredJobType || job.job_type === requiredJobType))
    if (jobs.some((job) => job.status === 'failed')) return 'failed'
    if (jobs.length > 0 && jobs.every((job) => job.status === 'completed')) return 'complete'
    if (jobs.some((job) => ['queued', 'waiting_for_worker', 'processing', 'uploading'].includes(job.status))) return 'processing'
    return null
  }
  function completionImageUsesBackground(imageId: string) {
    return completionBackgroundImageIds.includes(imageId)
  }
  function setCompletionImageUsesBackground(imageId: string, checked: boolean) {
    setCompletionBackgroundImageIds((current) =>
      checked ? Array.from(new Set([...current, imageId])) : current.filter((id) => id !== imageId)
    )
  }
  const viewedProcessedRepresentation =
    activeViewMode === 'background'
      ? backgroundRepresentation
      : activeViewMode === 'processed'
        ? processedRepresentation
        : activeViewMode === 'calibrated'
          ? calibratedRepresentation
          : null
  const phonePairExpanded = Boolean(phonePairUrl && (phonePairHoverExpanded || phonePairPinned))
  const usablePhoneSources = sources.filter(phoneSourceIsConnected)
  const usableFolderSources = sources.filter((source) => source.source_type === 'watched_folder' && sourceIsUsable(source))
  const pairedDeviceLabel = `${usablePhoneSources.length} device${usablePhoneSources.length === 1 ? '' : 's'} connected`
  const watchedFolderLabel = `${usableFolderSources.length} folder${usableFolderSources.length === 1 ? '' : 's'} active`

  function makeWorkerSetupUrl(sourceName: string, token: string) {
    if (!token) return ''
    const appUrl =
      typeof window !== 'undefined' &&
      /^https?:\/\//i.test(window.location.origin) &&
      !['null', 'undefined'].includes(window.location.origin)
        ? window.location.origin
        : ''
    const params = new URLSearchParams({
      app_url: appUrl,
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

            <button
              type="button"
              onClick={requestStationCalibrationCapture}
              disabled={busy || !station || calibrationCapturePending}
              className="h-10 rounded-lg bg-emerald-700 px-4 text-sm font-black text-white disabled:opacity-50"
            >
              {calibrationCapturePending ? 'Waiting For Calibration' : 'Refresh Calibration Image'}
            </button>

            {session?.status === 'active' ? (
              <button
                type="button"
                onClick={endSession}
                disabled={busy}
                className="h-10 rounded-lg bg-zinc-800 px-4 text-sm font-black text-white disabled:opacity-50"
              >
                End Session
              </button>
            ) : (
              <button
                type="button"
                onClick={startSessionFromMonitor}
                disabled={busy || !station}
                className="h-10 rounded-lg bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-50"
                title={monitorItemId ? 'Start a photo session for this SKU.' : 'Open Photo Monitor from Edit SKU to start a session.'}
              >
                Start Session
              </button>
            )}
          </div>
        </header>

        {message && (
          <div className="mb-4 rounded-xl border border-yellow-700 bg-yellow-950 px-4 py-3 text-sm font-bold text-yellow-200">
            {message}
          </div>
        )}

        {calibrationPromptOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl">
              <h2 className="text-xl font-black text-white">Calibration Image</h2>
              <p className="mt-2 text-sm font-bold text-zinc-300">
                Use a station calibration image for colour, crop, measurement and background removal.
                This is stored against the station, not this SKU.
              </p>

              {dailyReferenceProfile ? (
                <p className="mt-3 rounded-lg border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-xs font-bold text-emerald-100">
                  Previous: {dailyReferenceProfile.name} - {formatShortDateTime(dailyReferenceProfile.updated_at)}
                </p>
              ) : (
                <p className="mt-3 rounded-lg border border-yellow-800 bg-yellow-950/40 px-3 py-2 text-xs font-bold text-yellow-100">
                  No previous calibration image is saved for this station yet.
                </p>
              )}

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCalibrationPromptOpen(false)}
                  className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-black text-white"
                >
                  No
                </button>
                <button
                  type="button"
                  onClick={() => setCalibrationPromptOpen(false)}
                  disabled={!dailyReferenceProfile}
                  className="rounded-lg bg-white px-4 py-2 text-sm font-black text-black disabled:opacity-50"
                >
                  Use Previous
                </button>
                <button
                  type="button"
                  onClick={requestStationCalibrationCapture}
                  disabled={busy || !station}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
                >
                  Take Calibration Image
                </button>
              </div>
            </div>
          </div>
        )}

        {session?.status === 'active' && !dailyReferenceProfile && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-800 bg-emerald-950/50 px-4 py-3 text-sm font-bold text-emerald-100">
            <div>
              <span className="font-black">Add calibration image.</span>
              {' '}Use one calibration image for colour, crop, measurement and background removal.
            </div>
            <button
              type="button"
              onClick={requestStationCalibrationCapture}
              disabled={busy || !station || calibrationCapturePending}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white"
            >
              {calibrationCapturePending ? 'Waiting For Photo' : 'Take Calibration Image'}
            </button>
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
            <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl">
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
                      <span>Auto measure</span>
                      <ToggleSwitch
                        checked={autoMeasureOnComplete}
                        onChange={setAutoMeasureOnComplete}
                        label="Auto measure"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm font-black text-white">
                      <span>Apply active calibration</span>
                      <ToggleSwitch
                        checked={batchRunCalibration}
                        onChange={setBatchRunCalibration}
                        label="Apply active calibration"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm font-black text-white">
                      <span>Suggested crop / rotate</span>
                      <ToggleSwitch
                        checked={batchRunAutoCropRotate}
                        onChange={setBatchRunAutoCropRotate}
                        label="Suggested crop and rotate"
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
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-white">Preview Progress</p>
                        <p className="mt-2 text-sm font-bold text-zinc-400">
                          Waiting for worker output before these photos can be accepted.
                        </p>
                      </div>
                      <span
                        className={`rounded px-2 py-1 text-[10px] font-black ${
                          completionPreviewReady
                            ? 'bg-green-600 text-white'
                            : completionFailedJobs.length > 0
                              ? 'bg-red-700 text-white'
                              : 'bg-yellow-500 text-black'
                        }`}
                      >
                        {completionPreviewReady
                          ? 'Ready'
                          : completionFailedJobs.length > 0
                            ? 'Failed'
                            : 'Processing'}
                      </span>
                    </div>
                    <div className="mt-4">
                      <div className="h-3 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className={`h-full rounded-full ${
                            completionFailedJobs.length > 0 ? 'bg-red-600' : 'bg-emerald-500'
                          }`}
                          style={{ width: `${completionProgressPercent}%` }}
                        />
                      </div>
                      <p className="mt-2 text-xs font-bold text-zinc-400">
                        {completionDoneUnits} completed, {completionActiveJobs.length} active,
                        {' '}{completionFailedJobs.length} failed
                        {completionMissingJobCount ? `, ${completionMissingJobCount} waiting to load` : ''}
                        {' '}of {completionProgressUnits || 0}.
                      </p>
                    </div>
                    {completionFailedJobs[0]?.error_message && (
                      <p className="mt-3 rounded-lg border border-red-700 bg-red-950 p-3 text-xs font-bold text-red-100">
                        {completionFailedJobs[0].error_message}
                      </p>
                    )}
                    {!viewedProcessedRepresentation?.public_url && !completionPreviewReady && (
                      <p className="mt-3 rounded-lg border border-yellow-700 bg-yellow-950 p-3 text-xs font-bold text-yellow-100">
                        The selected photo preview is not ready yet, so the image below may still be the original.
                      </p>
                    )}
                    {displayUrl && (
                      <div className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
                        <div style={previewBackgroundStyle} className="flex min-h-[48vh] items-center justify-center overflow-hidden p-3">
                          <img
                            src={displayUrl}
                            alt="Selected preview"
                            className="max-h-[54vh] w-full object-contain"
                            style={
                              selectedManualCropActive && selectedCropHasChanges
                                ? {
                                    clipPath: `inset(${selectedCropTop}% ${selectedCropRight}% ${selectedCropBottom}% ${selectedCropLeft}%)`,
                                    transform: `rotate(${selectedCropSettings.rotation_degrees}deg)`,
                                    transformOrigin: 'center center',
                                  }
                                : undefined
                            }
                          />
                        </div>
                        <div className="border-t border-zinc-800 bg-zinc-950 p-3">
                          <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                            <div
                              className={`h-full rounded-full ${
                                completionFailedJobs.length > 0 ? 'bg-red-600' : 'bg-emerald-500'
                              }`}
                              style={{ width: `${completionProgressPercent}%` }}
                            />
                          </div>
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                            <p className="text-xs font-black text-zinc-300">
                              Image {selectedPreviewImagePosition || 0} of {thumbnailImages.length}
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => moveSelectedPreviewImage(-1)}
                                disabled={selectedPreviewImageIndex <= 0}
                                className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800 text-base font-black text-white disabled:opacity-40"
                                aria-label="Previous image"
                              >
                                {'<'}
                              </button>
                              <button
                                type="button"
                                onClick={() => moveSelectedPreviewImage(1)}
                                disabled={
                                  selectedPreviewImageIndex < 0 ||
                                  selectedPreviewImageIndex >= thumbnailImages.length - 1
                                }
                                className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800 text-base font-black text-white disabled:opacity-40"
                                aria-label="Next image"
                              >
                                {'>'}
                              </button>
                            </div>
                          </div>
                        </div>
                        </div>

                        {selectedImage?.id && (
                          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                            <p className="text-xs font-black uppercase tracking-wide text-white">Selected Image</p>
                            <p className="mt-1 text-[11px] font-bold text-zinc-400">
                              These controls apply only to this preview image.
                            </p>

                            {batchRunBackgroundRemoval && (
                              <label className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-zinc-700 bg-black p-3 text-xs font-black text-white">
                                <span>Background removal</span>
                                <input
                                  type="checkbox"
                                  checked={completionImageUsesBackground(selectedImage.id)}
                                  onChange={(event) => setCompletionImageUsesBackground(selectedImage.id, event.target.checked)}
                                  className="h-4 w-4"
                                />
                              </label>
                            )}

                            {batchRunAutoCropRotate && (
                              <div className="mt-4 space-y-3">
                                <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-700 bg-black p-3 text-xs font-black text-white">
                                  <span>Suggested crop / rotate</span>
                                  <ToggleSwitch
                                    checked={selectedCropSettings.auto_crop}
                                    onChange={(checked) => updateCropSettingsForImage(selectedImage.id, { auto_crop: checked })}
                                    label="Suggested crop and rotate"
                                  />
                                </div>

                                {!selectedCropSettings.auto_crop && (
                                  <div className="space-y-3">
                                    {[
                                      ['rotation_degrees', 'Rotate', -25, 25, 0.5, `${selectedCropSettings.rotation_degrees} deg`],
                                      ['crop_left_percent', 'Crop left', 0, 80, 1, `${selectedCropLeft}%`],
                                      ['crop_right_percent', 'Crop right', 0, 80, 1, `${selectedCropRight}%`],
                                      ['crop_top_percent', 'Crop top', 0, 80, 1, `${selectedCropTop}%`],
                                      ['crop_bottom_percent', 'Crop bottom', 0, 80, 1, `${selectedCropBottom}%`],
                                    ].map(([key, label, min, max, step, valueLabel]) => (
                                      <label key={key as string} className="block">
                                        <span className="mb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-wide text-zinc-500">
                                          <span>{label as string}</span>
                                          <span>{valueLabel as string}</span>
                                        </span>
                                        <input
                                          type="range"
                                          min={min as number}
                                          max={max as number}
                                          step={step as number}
                                          value={(selectedCropSettings as any)[key as string]}
                                          onChange={(event) =>
                                            updateCropSettingsForImage(selectedImage.id, {
                                              [key as string]: Number(event.target.value),
                                            } as Partial<ManualCropSettings>)
                                          }
                                          className="w-full accent-emerald-500"
                                        />
                                      </label>
                                    ))}
                                    <button
                                      type="button"
                                      onClick={() => updateCropSettingsForImage(selectedImage.id, defaultManualCropSettings)}
                                      className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white"
                                    >
                                      Reset Selected Crop
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {false && completionPreviewReady && batchRunAutoCropRotate && selectedImage?.id && (
                      <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                        {!selectedCropSettings.auto_crop && (
                          <div className="hidden">
                            {[
                              ['rotation_degrees', 'Rotate', -25, 25, 0.5, `${selectedCropSettings.rotation_degrees}°`],
                              ['zoom_percent', 'Zoom', 70, 180, 1, `${selectedCropSettings.zoom_percent}%`],
                              ['offset_x_percent', 'Move left/right', -50, 50, 1, `${selectedCropSettings.offset_x_percent}%`],
                              ['offset_y_percent', 'Move up/down', -50, 50, 1, `${selectedCropSettings.offset_y_percent}%`],
                            ].map(([key, label, min, max, step, valueLabel]) => (
                              <label key={key as string} className="block">
                                <span className="mb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-wide text-zinc-500">
                                  <span>{label as string}</span>
                                  <span>{valueLabel as string}</span>
                                </span>
                                <input
                                  type="range"
                                  min={min as number}
                                  max={max as number}
                                  step={step as number}
                                  value={(selectedCropSettings as any)[key as string]}
                                  onChange={(event) =>
                                    updateCropSettingsForImage(selectedImage.id, {
                                      [key as string]: Number(event.target.value),
                                    } as Partial<ManualCropSettings>)
                                  }
                                  className="w-full accent-emerald-500"
                                />
                              </label>
                            ))}
                            <button
                              type="button"
                              onClick={() => updateCropSettingsForImage(selectedImage.id, defaultManualCropSettings)}
                              className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white sm:col-span-2"
                            >
                              Reset Selected Crop
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end gap-2">
                    {batchRunBackgroundRemoval && (
                      <button
                        type="button"
                        onClick={() => setProcessingSettingsOpen('background')}
                        className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-black text-white"
                      >
                        Background Settings
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={rerunCompletionProcessingPreview}
                      disabled={busy || completionActiveJobs.length > 0}
                      className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
                    >
                      Rerun Preview
                    </button>
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
                      disabled={busy || !completionPreviewReady}
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
                    Sources and calibration settings for this capture bench.
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
                    Stations are added and renamed from Settings - Station Agent or the Windows Station Agent.
                  </p>
                  {station ? (
                    <div className="mt-3 grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs font-bold text-zinc-400">
                      <p>Name: <span className="text-zinc-200">{station.name}</span></p>
                      <p>Code: <span className="text-zinc-200">{station.code}</span></p>
                      <p>Status: <span className="text-zinc-200">{station.status || 'active'}</span></p>
                    </div>
                  ) : (
                    <p className="mt-3 rounded-lg border border-dashed border-zinc-700 p-3 text-center text-xs font-bold text-zinc-500">
                      No station selected.
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-zinc-800 bg-black p-4">
                  <h3 className="text-sm font-black text-white">Sources</h3>
                  <p className="mt-1 text-xs font-bold text-zinc-400">
                    Sources are created by the Windows Station Agent when watched folders are saved there.
                  </p>

                  <div className="mt-3 space-y-2">
                    {sources.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-zinc-700 p-3 text-center text-xs font-bold text-zinc-500">
                        No sources yet. Add a watched folder in the Windows Station Agent for this station.
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
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span
                                className={`rounded-full px-2 py-1 text-[10px] font-black ${
                                  source.source_type === 'phone' ? phoneSourceIsConnected(source) : sourceIsUsable(source)
                                    ? 'bg-green-600 text-white'
                                    : 'bg-zinc-700 text-zinc-300'
                                }`}
                              >
                                {source.source_type === 'phone'
                                  ? phoneSourceIsConnected(source)
                                    ? 'CONNECTED'
                                    : sourceIsUsable(source)
                                      ? 'STALE'
                                      : 'OFF'
                                  : sourceIsUsable(source)
                                    ? 'READY'
                                    : 'OFF'}
                              </span>
                              <button
                                type="button"
                                onClick={() => deletePhotoSource(source)}
                                disabled={busy}
                                className="rounded bg-red-900 px-2 py-1 text-[10px] font-black text-red-100 disabled:opacity-50"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                          <p className="mt-2 text-xs font-bold text-zinc-500">
                            {source.source_type === 'phone' ? 'Paired phone' : 'Watched folder'} - token ****{source.token_last_four || 'none'}
                          </p>
                          {source.source_type === 'watched_folder' && (
                            <p className="mt-2 break-all rounded-md border border-zinc-800 bg-black px-2 py-1 text-[11px] font-bold text-zinc-300">
                              Folder: {source.local_reference?.watch_folder || 'Path not synced yet. Re-save the folder in Station Agent.'}
                            </p>
                          )}
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
                        <option value="station_daily_reference">Session Calibration Reference</option>
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

                  <div className="mt-3 rounded-xl border border-emerald-900 bg-emerald-950/40 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-white">Calibration Image</p>
                        <p className="mt-1 text-xs font-bold text-emerald-100/80">
                          Use one calibration image to guide colour, ArUco scale, measurements, background removal and crop for this station.
                        </p>
                        <p className="mt-2 text-xs font-bold text-emerald-100">
                          {dailyReferenceProfile
                            ? `${dailyReferenceProfile.name} - ${formatShortDateTime(dailyReferenceProfile.updated_at)}`
                            : 'No calibration image saved yet.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={saveSelectedAsDailyReference}
                        disabled={busy || !selectedCapture}
                        className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                      >
                        Add Calibration Image
                      </button>
                    </div>
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
                <div className="space-y-4">
                  <div className="rounded-lg border border-emerald-700 bg-emerald-950 p-3 text-xs font-bold text-emerald-100">
                    {cropGuidelineForItem(item)}
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-700 bg-zinc-950 p-1">
                    {[
                      { value: 'auto', label: 'Auto crop' },
                      { value: 'centre', label: 'Centre crop' },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() =>
                          setCropRotateSettings((current) => ({
                            ...current,
                            mode: option.value as CropRotateSettings['mode'],
                          }))
                        }
                        className={`rounded-md px-3 py-2 text-xs font-black ${
                          cropRotateSettings.mode === option.value ? 'bg-emerald-600 text-white' : 'text-zinc-300'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  <label className="block">
                    <span className="mb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-wide text-zinc-500">
                      <span>Whitespace around garment</span>
                      <span>{cropRotateSettings.whitespace_percent}%</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={30}
                      value={cropRotateSettings.whitespace_percent}
                      onChange={(event) =>
                        setCropRotateSettings((current) => ({
                          ...current,
                          whitespace_percent: Number(event.target.value || 0),
                        }))
                      }
                      className="w-full accent-emerald-500"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-wide text-zinc-500">
                      <span>Rotate</span>
                      <span>{cropRotateSettings.rotation_degrees}°</span>
                    </span>
                    <input
                      type="range"
                      min={-15}
                      max={15}
                      step={0.5}
                      value={cropRotateSettings.rotation_degrees}
                      onChange={(event) =>
                        setCropRotateSettings((current) => ({
                          ...current,
                          rotation_degrees: Number(event.target.value || 0),
                        }))
                      }
                      className="w-full accent-emerald-500"
                    />
                  </label>

                  <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-xs font-black text-white">
                    <span>Ignore close-ups</span>
                    <ToggleSwitch
                      checked={cropRotateSettings.skip_closeups}
                      onChange={(checked) =>
                        setCropRotateSettings((current) => ({
                          ...current,
                          skip_closeups: checked,
                        }))
                      }
                      label="Ignore close-ups"
                    />
                  </div>

                  <label className="block">
                    <span className="mb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-wide text-zinc-500">
                      <span>Close-up threshold</span>
                      <span>{cropRotateSettings.closeup_threshold}%</span>
                    </span>
                    <input
                      type="range"
                      min={70}
                      max={98}
                      value={cropRotateSettings.closeup_threshold}
                      onChange={(event) =>
                        setCropRotateSettings((current) => ({
                          ...current,
                          closeup_threshold: Number(event.target.value || 90),
                        }))
                      }
                      className="w-full accent-emerald-500"
                    />
                  </label>
                  <p className="rounded-lg border border-zinc-800 bg-black p-3 text-xs font-bold text-zinc-400">
                    Auto crop finds the visible item and leaves the chosen whitespace. Centre crop keeps framing centred
                    and only applies rotation/resize. Close-ups are skipped when the item already fills the frame.
                  </p>
                </div>
              )}

              {processingSettingsOpen === 'background' && (
                <div className="space-y-4">
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-zinc-500">
                      Background model
                    </span>
                    <select
                      value={backgroundRemovalSettings.model}
                      onChange={(event) =>
                        updateBackgroundRemovalSettings({
                          model: event.target.value as BackgroundRemovalSettings['model'],
                        })
                      }
                      className="h-9 w-full rounded-lg border border-zinc-700 bg-black px-3 text-xs font-bold text-white outline-none focus:border-white"
                    >
                      <option value="isnet-general-use">Product detail - isnet general</option>
                      <option value="u2net">General - u2net</option>
                      <option value="silueta">Clean silhouettes - silueta</option>
                      <option value="u2netp">Fast preview - u2netp</option>
                    </select>
                  </label>

                  <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-xs font-black text-white">
                    <span>Fine edge matting</span>
                    <ToggleSwitch
                      checked={backgroundRemovalSettings.alpha_matting}
                      onChange={(checked) => updateBackgroundRemovalSettings({ alpha_matting: checked })}
                      label="Fine edge matting"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-zinc-500">
                        Foreground
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={255}
                        value={backgroundRemovalSettings.foreground_threshold}
                        onChange={(event) =>
                          updateBackgroundRemovalSettings({
                            foreground_threshold: Number(event.target.value || 0),
                          })
                        }
                        className="h-9 w-full rounded-lg border border-zinc-700 bg-black px-3 text-xs font-bold text-white outline-none focus:border-white"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-zinc-500">
                        Background
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={255}
                        value={backgroundRemovalSettings.background_threshold}
                        onChange={(event) =>
                          updateBackgroundRemovalSettings({
                            background_threshold: Number(event.target.value || 0),
                          })
                        }
                        className="h-9 w-full rounded-lg border border-zinc-700 bg-black px-3 text-xs font-bold text-white outline-none focus:border-white"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-zinc-500">
                        Edge cleanup
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={80}
                        value={backgroundRemovalSettings.erode_size}
                        onChange={(event) =>
                          updateBackgroundRemovalSettings({
                            erode_size: Number(event.target.value || 0),
                          })
                        }
                        className="h-9 w-full rounded-lg border border-zinc-700 bg-black px-3 text-xs font-bold text-white outline-none focus:border-white"
                      />
                    </label>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-xs font-black text-white">
                    <span>Post-process mask</span>
                    <ToggleSwitch
                      checked={backgroundRemovalSettings.post_process_mask}
                      onChange={(checked) => updateBackgroundRemovalSettings({ post_process_mask: checked })}
                      label="Post-process mask"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-xs font-black text-white">
                    <span>Skip full-frame images</span>
                    <ToggleSwitch
                      checked={backgroundRemovalSettings.skip_full_frame}
                      onChange={(checked) => updateBackgroundRemovalSettings({ skip_full_frame: checked })}
                      label="Skip full-frame images"
                    />
                  </div>

                  <label className="block">
                    <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-zinc-500">
                      Full-frame threshold %
                    </span>
                    <input
                      type="number"
                      min={70}
                      max={99}
                      value={backgroundRemovalSettings.full_frame_threshold}
                      onChange={(event) =>
                        updateBackgroundRemovalSettings({
                          full_frame_threshold: Number(event.target.value || 94),
                        })
                      }
                      className="h-9 w-full rounded-lg border border-zinc-700 bg-black px-3 text-xs font-bold text-white outline-none focus:border-white"
                    />
                  </label>

                  <p className="rounded-lg border border-zinc-800 bg-black p-3 text-xs font-bold text-zinc-400">
                    Output is a transparent PNG preview. Higher foreground values usually preserve more garment edge;
                    higher edge cleanup can remove halos but may eat into fine fabric details. Full-frame skip keeps the
                    image unchanged when the detected item fills almost the whole frame.
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
                    const previewUrl = displayUrlForImage(image)
                    const processingStatus = completionStatusForImage(image)
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
                            src={previewUrl}
                            alt=""
                            className="aspect-square w-full object-cover"
                          />
                        </button>
                        {processingStatus && (
                          <span
                            className={`absolute bottom-1 left-1 rounded px-1.5 py-0.5 text-[9px] font-black uppercase text-white ${
                              processingStatus === 'complete'
                                ? 'bg-green-600'
                                : processingStatus === 'failed'
                                  ? 'bg-red-700'
                                  : 'bg-yellow-600 text-black'
                            }`}
                          >
                            {processingStatus === 'complete' ? 'Done' : processingStatus}
                          </span>
                        )}
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
                  <p className="mt-1 text-[11px] font-black text-emerald-300">
                    {pairedDeviceLabel} - {watchedFolderLabel}
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
                    key: 'measure',
                    label: 'Auto measure',
                    enabled: autoMeasureOnComplete,
                    setEnabled: setAutoMeasureOnComplete,
                    status: selectedIsMeasurementSource ? 'source selected' : 'needs source photo',
                  },
                  {
                    key: 'calibration',
                    label: 'Calibration',
                    enabled: batchRunCalibration,
                    setEnabled: setBatchRunCalibration,
                    status: calibratedRepresentation?.public_url ? 'ready' : 'not generated',
                  },
                  {
                    key: 'crop_rotate',
                    label: 'Suggested crop / rotate',
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
                      onClick={() => {
                        if (option.key === 'measure') {
                          setShowArucoLayoutModal(true)
                          return
                        }
                        setProcessingSettingsOpen(option.key as 'calibration' | 'crop_rotate' | 'background')
                      }}
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
                    label: 'Suggested crop / rotate',
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
                  onClick={() => runBatchPreviewPipeline()}
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

          </aside>

          <div
            className="order-1 flex min-h-0 items-center justify-center overflow-hidden rounded-2xl border border-zinc-800 bg-black lg:order-2"
            style={previewBackgroundStyle}
          >
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
