export type RfidZoneType =
  | 'movement_log'
  | 'restricted_area'
  | 'exit_security'
  | 'stock_room'
  | 'changing_room'
  | 'custom'

export type RfidZoneRules = {
  ignore_unknown_tags?: boolean
  create_events_for_unknown_tags?: boolean
  alarm_on_unpaid_exit?: boolean
  alarm_on_unpaid_threshold?: boolean
  alarm_on_stale_inside?: boolean
  min_alarm_rssi?: number
  min_alarm_read_count?: number
  min_alarm_dwell_seconds?: number
  stale_inside_seconds?: number
  alarm_cooldown_seconds?: number
}

export const RFID_ZONE_DEFAULT_RULES: Record<RfidZoneType, RfidZoneRules> = {
  movement_log: {
    ignore_unknown_tags: true,
    create_events_for_unknown_tags: false,
    alarm_on_unpaid_exit: false,
    alarm_on_unpaid_threshold: false,
    alarm_on_stale_inside: false,
    min_alarm_rssi: -52,
    min_alarm_read_count: 3,
    min_alarm_dwell_seconds: 1.5,
    stale_inside_seconds: 180,
    alarm_cooldown_seconds: 12,
  },
  restricted_area: {
    ignore_unknown_tags: true,
    create_events_for_unknown_tags: false,
    alarm_on_unpaid_exit: false,
    alarm_on_unpaid_threshold: false,
    alarm_on_stale_inside: true,
    min_alarm_rssi: -58,
    min_alarm_read_count: 3,
    min_alarm_dwell_seconds: 2,
    stale_inside_seconds: 180,
    alarm_cooldown_seconds: 20,
  },
  exit_security: {
    ignore_unknown_tags: true,
    create_events_for_unknown_tags: false,
    alarm_on_unpaid_exit: true,
    alarm_on_unpaid_threshold: true,
    alarm_on_stale_inside: false,
    min_alarm_rssi: -50,
    min_alarm_read_count: 4,
    min_alarm_dwell_seconds: 1.2,
    stale_inside_seconds: 120,
    alarm_cooldown_seconds: 12,
  },
  stock_room: {
    ignore_unknown_tags: true,
    create_events_for_unknown_tags: false,
    alarm_on_unpaid_exit: false,
    alarm_on_unpaid_threshold: false,
    alarm_on_stale_inside: false,
    min_alarm_rssi: -56,
    min_alarm_read_count: 3,
    min_alarm_dwell_seconds: 1.5,
    stale_inside_seconds: 300,
    alarm_cooldown_seconds: 20,
  },
  changing_room: {
    ignore_unknown_tags: true,
    create_events_for_unknown_tags: false,
    alarm_on_unpaid_exit: false,
    alarm_on_unpaid_threshold: false,
    alarm_on_stale_inside: true,
    min_alarm_rssi: -58,
    min_alarm_read_count: 3,
    min_alarm_dwell_seconds: 1.5,
    stale_inside_seconds: 240,
    alarm_cooldown_seconds: 20,
  },
  custom: {
    ignore_unknown_tags: true,
    create_events_for_unknown_tags: false,
    alarm_on_unpaid_exit: false,
    alarm_on_unpaid_threshold: false,
    alarm_on_stale_inside: false,
    min_alarm_rssi: -52,
    min_alarm_read_count: 3,
    min_alarm_dwell_seconds: 1.5,
    stale_inside_seconds: 180,
    alarm_cooldown_seconds: 12,
  },
}

export function mergedRfidZoneRules(zoneType: string, rules: any): Required<RfidZoneRules> {
  const key = (zoneType in RFID_ZONE_DEFAULT_RULES ? zoneType : 'custom') as RfidZoneType
  const merged = { ...RFID_ZONE_DEFAULT_RULES[key], ...(rules || {}) }

  return {
    ignore_unknown_tags: merged.ignore_unknown_tags !== false,
    create_events_for_unknown_tags: merged.create_events_for_unknown_tags === true,
    alarm_on_unpaid_exit: merged.alarm_on_unpaid_exit === true,
    alarm_on_unpaid_threshold: merged.alarm_on_unpaid_threshold === true,
    alarm_on_stale_inside: merged.alarm_on_stale_inside === true,
    min_alarm_rssi: Number.isFinite(Number(merged.min_alarm_rssi)) ? Number(merged.min_alarm_rssi) : -52,
    min_alarm_read_count: Math.max(1, Math.round(Number(merged.min_alarm_read_count) || 3)),
    min_alarm_dwell_seconds: Math.max(0, Number(merged.min_alarm_dwell_seconds) || 0),
    stale_inside_seconds: Math.max(0, Number(merged.stale_inside_seconds) || 0),
    alarm_cooldown_seconds: Math.max(0, Number(merged.alarm_cooldown_seconds) || 0),
  }
}
