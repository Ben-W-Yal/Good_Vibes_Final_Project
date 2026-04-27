#!/usr/bin/env python3
"""
PySpaceMouse -> WebSocket bridge for the GeoIntel web client.

Usage:
  pip install pyspacemouse websockets
  python script/spacemouse_bridge.py --host 127.0.0.1 --port 8765
"""

import argparse
import asyncio
import ctypes
import json
import os
import pathlib
import signal
import time
from typing import Any

import websockets
from websockets.server import WebSocketServerProtocol


def _prepare_hidapi_macos() -> None:
    """
    Ensure hidapi is discoverable on macOS Homebrew installs.

    Some Python/cffi setups do not search /opt/homebrew by default, so we:
    1) pre-load libhidapi.dylib via ctypes, and
    2) prepend the library path to DYLD_LIBRARY_PATH for child lookups.
    """
    if os.name != "posix":
        return
    candidates = [
        pathlib.Path("/opt/homebrew/Cellar/hidapi"),
        pathlib.Path("/usr/local/Cellar/hidapi"),
    ]
    for root in candidates:
        if not root.exists():
            continue
        versions = sorted((p for p in root.iterdir() if p.is_dir()), reverse=True)
        for version_dir in versions:
            lib_dir = version_dir / "lib"
            lib_file = lib_dir / "libhidapi.dylib"
            if not lib_file.exists():
                continue
            current = os.environ.get("DYLD_LIBRARY_PATH", "")
            lib_dir_str = str(lib_dir)
            if lib_dir_str not in current.split(":"):
                os.environ["DYLD_LIBRARY_PATH"] = (
                    f"{lib_dir_str}:{current}" if current else lib_dir_str
                )
            try:
                ctypes.CDLL(str(lib_file))
            except OSError:
                continue
            return


_prepare_hidapi_macos()
import pyspacemouse


def clamp(value: Any) -> float:
    if not isinstance(value, (int, float)):
        return 0.0
    return max(-1.0, min(1.0, float(value)))


def state_to_payload(state: Any) -> dict[str, float]:
    # PySpaceMouse state exposes x/y/z + roll/pitch/yaw.
    return {
        "tx": clamp(getattr(state, "x", 0.0)),
        "ty": clamp(getattr(state, "y", 0.0)),
        "tz": clamp(getattr(state, "z", 0.0)),
        "rx": clamp(getattr(state, "pitch", 0.0)),
        "ry": clamp(getattr(state, "roll", 0.0)),
        "rz": clamp(getattr(state, "yaw", 0.0)),
        "t": time.time(),
    }


class SpaceMouseBridge:
    def __init__(self) -> None:
        self.clients: set[WebSocketServerProtocol] = set()
        self.stop_event = asyncio.Event()

    async def on_client(self, websocket: WebSocketServerProtocol) -> None:
        self.clients.add(websocket)
        try:
            await websocket.wait_closed()
        finally:
            self.clients.discard(websocket)

    async def broadcast(self, payload: dict[str, float]) -> None:
        if not self.clients:
            return
        message = json.dumps(payload, separators=(",", ":"))
        dead: list[WebSocketServerProtocol] = []
        for ws in self.clients:
            try:
                await ws.send(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    def _open_first_available_device(self):
        connected = pyspacemouse.get_connected_devices()
        if not connected:
            raise RuntimeError("No SpaceMouse devices detected")

        # Some macOS setups expose multiple HID interfaces for one physical
        # device; only one is readable. Try each index until open succeeds.
        last_error: Exception | None = None
        for idx in range(len(connected)):
            try:
                return pyspacemouse.open(device_index=idx)
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                continue
        if last_error:
            raise RuntimeError(f"Failed to open any SpaceMouse interface: {last_error}") from last_error
        raise RuntimeError("Failed to open any SpaceMouse interface")

    async def read_loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                print("Opening SpaceMouse via pyspacemouse...", flush=True)
                with self._open_first_available_device() as device:
                    print("SpaceMouse connected. Streaming motion frames.", flush=True)
                    while not self.stop_event.is_set():
                        state = await asyncio.to_thread(device.read)
                        if state is None:
                            await asyncio.sleep(0.005)
                            continue
                        await self.broadcast(state_to_payload(state))
                        await asyncio.sleep(0.005)
            except Exception as exc:  # noqa: BLE001
                message = str(exc)
                if "Failed to open device" in message:
                    message += (
                        " (device appears busy/claimed; quit 3DconnexionHelper and retry)"
                    )
                print(f"[bridge] SpaceMouse open/read failed: {message}", flush=True)
                await asyncio.sleep(1.0)

    async def run(self, host: str, port: int) -> None:
        async with websockets.serve(self.on_client, host, port):
            print(f"Bridge listening on ws://{host}:{port}", flush=True)
            await self.read_loop()


async def main() -> None:
    parser = argparse.ArgumentParser(description="SpaceMouse WebSocket bridge")
    parser.add_argument("--host", default="127.0.0.1", help="bind host")
    parser.add_argument("--port", type=int, default=8765, help="bind port")
    args = parser.parse_args()

    bridge = SpaceMouseBridge()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, bridge.stop_event.set)
        except NotImplementedError:
            pass

    await bridge.run(args.host, args.port)


if __name__ == "__main__":
    asyncio.run(main())
