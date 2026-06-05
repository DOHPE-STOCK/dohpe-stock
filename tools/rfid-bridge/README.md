# RFID table bridge

StockMaster controls the RFID table through a local HTTP bridge running on the scanner/table device.

Default URL used by the Receiving page:

```text
http://127.0.0.1:8765
```

The bridge can be implemented with the vendor Python, C#, C++, Java, Android, or Windows API. This folder includes a Python bridge first because the Fuzetec SDK includes `python-api/example` files using `uhfReaderApi`.

## Install on the receiving PC

Easiest route on this Windows machine:

```powershell
cd "C:\Users\David's Laptop\Documents\Codex\2026-05-24\ok-are-you-connected-to-my\dohpe-stock\tools\rfid-bridge"

.\install-vendor-sdk.cmd
```

This uses the bundled Codex Python when available. If you later install Python properly on Windows, the same script can use normal `python`.

Manual venv route, if preferred:

```powershell
cd "C:\Users\David's Laptop\Documents\Codex\2026-05-24\ok-are-you-connected-to-my\dohpe-stock\tools\rfid-bridge"

py -m venv .venv

.\.venv\Scripts\Activate.ps1

pip install -r requirements.txt
```

If the normal pip source fails, the vendor note says this mirror can be used:

```powershell
pip install -i https://pypi.tuna.tsinghua.edu.cn/simple uhfReaderApi
```

## Run in mock mode now

This proves StockMaster can talk to the bridge before the table arrives:

```powershell
.\.venv\Scripts\Activate.ps1

python .\rfid_bridge.py --mode mock
```

Then open Processing > Receiving and use:

```text
Bridge URL: http://127.0.0.1:8765
```

Click Start Scan. Mock TIDs should appear and count up.

## Run against the table over RJ45/TCP

If the table is configured with IP `192.168.1.168` and port `8160`, run:

```powershell
cd "C:\Users\David's Laptop\Documents\Codex\2026-05-24\ok-are-you-connected-to-my\dohpe-stock\tools\rfid-bridge"

.\run-real-table-tcp.cmd
```

The Fuzetec Python SDK examples show:

```python
g_client.openTcp(("192.168.1.168", 8160))
g_client.callEpcInfo = receivedEpc

msg = MsgBaseInventoryEpc(
    antennaEnable=EnumG.AntennaNo_1.value,
    inventoryMode=EnumG.InventoryMode_Inventory.value,
)
msg.readTid = ParamEpcReadTid(mode=EnumG.ParamTidMode_Auto.value, dataLen=6)
g_client.sendSynMsg(msg)
```

So RJ45/TCP should be the cleanest receiving-PC setup if the reader is on the same network.

## Run over serial/USB adapter

The vendor docs also show serial:

```powershell
python .\rfid_bridge.py --mode serial --serial-port COM7 --baud 115200
```

Change `COM7` to whatever Windows Device Manager shows.

## Duplicate reads

The reader may report the same tag many times during an inventory scan. The bridge stores tags in a dictionary by normalized TID, so the list/count returned to StockMaster is unique.

That means 37 hang tags repeatedly read on the table should still show as:

```text
37 / 37
```

not hundreds of duplicate reads.

## Endpoints

### `GET /status`

Returns current connection/scanning state and the current unique TID list.

```json
{
  "connected": true,
  "scanning": true,
  "count": 37,
  "tids": [
    "E28011700000020D12345678",
    "E28011700000020D12345679"
  ]
}
```

`tags` is also accepted instead of `tids`, and each row may be either a string or an object with `tid`, `TID`, `epc`, or `EPC`.

### `POST /scan/start`

Starts a table inventory/read session.

```json
{
  "expected_quantity": 37,
  "read_tid": true
}
```

The Python bridge uses the Fuzetec SDK's TID read mode:
`MsgBaseInventoryEpc` with `msg.readTid = ParamEpcReadTid(mode=EnumG.ParamTidMode_Auto.value, dataLen=6)`.

### `POST /scan/stop`

Stops the current scan without clearing the list.

### `POST /clear`

Clears the current TID list.

## Browser requirements

The bridge must return CORS headers, for example:

```text
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: content-type
Access-Control-Allow-Methods: GET,POST,OPTIONS
```

For production SaaS, this can be tightened to the active StockMaster domain.
