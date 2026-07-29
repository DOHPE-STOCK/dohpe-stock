# Loopbase RFID Zone Monitor

Local monitor for RUX2X/RU4XX-style fixed UHF RFID readers used at a doorway, changing-room entrance, store exit, or other threshold.

This is deliberately separate from `tools/rfid-bridge`, which is for receiving-table RFID workflows.

## What It Does

- Connects to a reader in `tcp_command` mode, or accepts a reader stream in `tcp_stream_server` mode.
- Parses the vendor `AA AA ... CRC-CCITT` frame format from the RUX2X SDK.
- Starts multi-tag inventory with EPC or EPC+TID reads.
- Deduplicates constant repeated reads.
- Tracks which antenna/side saw a tag first and last.
- Infers simple zone events such as `entered`, `exited`, `inside`, and `outside`.
- Shows live active reads, inside-zone items, stale-inside alerts, and recent events at `http://127.0.0.1:8775`.

## Development Run

```powershell
cd "C:\Users\David's Laptop\Documents\Codex\2026-05-24\ok-are-you-connected-to-my\dohpe-stock\tools\rfid-zone-monitor"
.\run-zone-monitor.cmd
```

Open:

```text
http://127.0.0.1:8775
```

## Modes

- `mock`: simulates a few tags moving from outside antenna to inside antenna.
- `tcp_command`: Loopbase connects to the reader, optionally applies antenna settings, then sends multi-tag inventory commands.
- `tcp_stream_server`: the reader is configured in polling mode and connects/streams standard TCP protocol frames to this local monitor.

Set `app_url` and `zone_token` to post completed movement events to Loopbase:

```json
{
  "app_url": "https://loopbase.io",
  "zone_token": "lbz_..."
}
```

## Reader Defaults From The SDK

- Default reader IP: `192.168.0.200`
- Default reader TCP port: `200`
- Frame header: `AA AA`
- CRC: CRC-CCITT, polynomial `0x1021`, initial value `0xffff`
- Multi-tag inventory command: `0xC1`
- Stop inventory command: `0xC0`
- Antenna parameter command: `0x3F`
- Global RF power command: `0x3B`
- Reset reader command: `0x0F`
- GPIO/GPO command: `0x0A 0x00`

## Built-in Alarm / Light Output

The vendor SDK documents reader GPO/alarm output control on command `0x0A 0x00`. Some readers expose this as built-in alarm/light hardware rather than external wiring. Loopbase uses that documented command directly when `alarm_output_enabled` is true.

Typical setup:

```json
{
  "alarm_output_enabled": true,
  "alarm_gpo_port": 1,
  "alarm_active_level": 1,
  "alarm_pulse_seconds": 3,
  "alarm_trigger_on_app_alarm": true
}
```

Select the reader output port that controls the hardware alarm/light on the installed unit. The local monitor has:

- `Turn Off Built-in Alarm`: sets the configured alarm output to the inactive level.
- `Test Built-in Alarm/Light`: pulses the configured alarm output.
- `Test Built-in Warning`: pulses the configured warning output.

`exit_warning_enabled` is a local, pre-confirmation warning pulse based only on direction, RSSI and read count. Leave it off until the doorway is tuned, because it cannot know whether the item is paid until Loopbase has checked the tag.

The vendor configuration tool also has a simple beeper on/off switch, but the public protocol documents the GPO/alarm-output command. Loopbase therefore treats the built-in alarm/light as the primary controllable theft-alert output.

## Direction Setup

In `config.local.json`, map antenna numbers to sides:

```json
"antenna_ports": [
  { "antenna": 1, "enabled": true, "side": "outside", "power_dbm": 24, "inventory_count": 4 },
  { "antenna": 2, "enabled": true, "side": "inside", "power_dbm": 24, "inventory_count": 4 }
]
```

For a fitting-room door, put one antenna on the outside approach and one on the inside/room side. The monitor uses first side and last side after the tag disappears from the beam to infer movement.

## Tuning Notes

- Lower `power_dbm` to reduce over-reading into neighbouring spaces.
- If every antenna needs reducing together, set `global_power_dbm` and use `Apply Power` in the local monitor, or enable `apply_global_power_on_start`.
- Increase `dedupe_window_seconds` if the same tag floods the event list.
- Increase `present_ttl_seconds` if tags briefly drop out while passing through the doorway.
- Increase `room_stale_alert_seconds` if people normally spend longer in the changing room.
- For exit security, tune `exit_warning_min_rssi`, `exit_warning_min_read_count`, antenna side mapping and per-antenna `power_dbm` before enabling any physical warning output.

Frequency region, FHSS and channel settings are available in the vendor protocol but are intentionally not exposed as ordinary Loopbase buttons yet. Those affect regulatory installation behaviour and should be set once during hardware commissioning.
