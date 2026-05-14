"""
Shared debug logger for the Magos Skeleton Editor node pack.

Writes structured trace output to:
  1. Stdout (visible in ComfyUI's CMD window — the user can copy-paste)
  2. A single per-session log file in `<pack>/logs/session_<YYYYmmdd_HHMMSS>.log`

All four nodes (Extractor, Editor, Retargeter, Renderer) plus JS user actions
write to the SAME session log so the full pipeline is chronologically ordered
in one place.

Enable per-node by toggling the node's `debug_log` widget. When any node
enables logging, the global session is started; toggling off stops writes
from that node but the session file remains for the rest of the run.

Usage (Python side):

    from .debug_logger import get_logger
    log = get_logger("Retargeter", enabled=debug_log)
    log.section("EXECUTE START", {"frames": B, "widget_x": wx})
    log.kv("orig_r_wrist", orig_kps[R_WRIST])
    log.array("new_kps", new_kps)         # summarises long arrays
"""

from __future__ import annotations

import datetime as _dt
import json as _json
import os as _os
import threading as _threading
from typing import Any, Optional

import numpy as _np

_PACK_DIR = _os.path.dirname(_os.path.abspath(__file__))
_LOG_DIR = _os.path.join(_PACK_DIR, "logs")

_SESSION_LOCK = _threading.Lock()
_SESSION_PATH: Optional[str] = None
_SESSION_FILE = None


def _ensure_session() -> str:
    """Open (or reuse) the single session log file. Returns its path."""
    global _SESSION_PATH, _SESSION_FILE
    with _SESSION_LOCK:
        if _SESSION_FILE is not None:
            return _SESSION_PATH  # type: ignore[return-value]
        _os.makedirs(_LOG_DIR, exist_ok=True)
        ts = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        _SESSION_PATH = _os.path.join(_LOG_DIR, f"session_{ts}.log")
        _SESSION_FILE = open(_SESSION_PATH, "a", encoding="utf-8", buffering=1)
        header = f"\n{'=' * 72}\nMAGOS DEBUG SESSION — opened {ts}\n{'=' * 72}\n"
        _SESSION_FILE.write(header)
        print(header, flush=True)
    return _SESSION_PATH


def _write(line: str) -> None:
    """Write to both stdout and the session file."""
    print(line, flush=True)
    with _SESSION_LOCK:
        if _SESSION_FILE is not None:
            try:
                _SESSION_FILE.write(line + "\n")
            except Exception:
                pass


def _fmt_val(v: Any, max_items: int = 6) -> str:
    """Compact, readable repr for arrays/tensors/dicts."""
    if v is None:
        return "None"
    if isinstance(v, _np.ndarray):
        shape = tuple(v.shape)
        if v.size == 0:
            return f"ndarray{shape}=empty"
        flat = v.reshape(-1)
        head = ", ".join(f"{float(x):.3f}" for x in flat[:max_items].tolist())
        tail = " …" if flat.size > max_items else ""
        return f"ndarray{shape} dtype={v.dtype} [{head}{tail}]"
    if hasattr(v, "shape") and hasattr(v, "dtype"):  # torch tensor w/o import
        try:
            arr = v.detach().cpu().numpy() if hasattr(v, "detach") else _np.asarray(v)
            return _fmt_val(arr, max_items)
        except Exception:
            return f"<tensor shape={tuple(v.shape)} dtype={v.dtype}>"
    if isinstance(v, (list, tuple)):
        if len(v) == 0:
            return f"{type(v).__name__}(len=0)"
        if all(isinstance(x, (int, float)) for x in v):
            head = ", ".join(f"{float(x):.3f}" for x in v[:max_items])
            tail = " …" if len(v) > max_items else ""
            return f"{type(v).__name__}(len={len(v)}) [{head}{tail}]"
        return f"{type(v).__name__}(len={len(v)}) first={_fmt_val(v[0], max_items)}"
    if isinstance(v, dict):
        keys = list(v.keys())
        head = ", ".join(str(k) for k in keys[:max_items])
        tail = " …" if len(keys) > max_items else ""
        return f"dict(len={len(keys)}) keys=[{head}{tail}]"
    if isinstance(v, float):
        return f"{v:.4f}"
    if isinstance(v, str) and len(v) > 80:
        return _json.dumps(v[:77] + "…")
    return repr(v)


class _NodeLogger:
    def __init__(self, node: str, enabled: bool) -> None:
        self.node = node
        self.enabled = bool(enabled)
        if self.enabled:
            _ensure_session()

    def _ts(self) -> str:
        return _dt.datetime.now().strftime("%H:%M:%S.%f")[:-3]

    def _prefix(self) -> str:
        return f"[{self._ts()}] [{self.node:<10}]"

    def section(self, title: str, data: Optional[dict] = None) -> None:
        if not self.enabled:
            return
        bar = "-" * 60
        _write(f"{self._prefix()} {bar}")
        _write(f"{self._prefix()} {title}")
        if data:
            for k, v in data.items():
                _write(f"{self._prefix()}   {k} = {_fmt_val(v)}")

    def kv(self, key: str, value: Any) -> None:
        if not self.enabled:
            return
        _write(f"{self._prefix()}   {key} = {_fmt_val(value)}")

    def msg(self, message: str) -> None:
        if not self.enabled:
            return
        _write(f"{self._prefix()} {message}")

    def array(self, name: str, arr: Any) -> None:
        """Full per-row dump of a 2D keypoint array (N, 2..4)."""
        if not self.enabled:
            return
        try:
            a = _np.asarray(arr)
        except Exception:
            _write(f"{self._prefix()}   {name} = {_fmt_val(arr)}")
            return
        if a.ndim != 2:
            _write(f"{self._prefix()}   {name} = {_fmt_val(a)}")
            return
        _write(f"{self._prefix()}   {name} shape={a.shape}:")
        for i, row in enumerate(a.tolist()):
            vals = ", ".join(f"{float(x):8.3f}" for x in row)
            _write(f"{self._prefix()}     [{i:2d}] {vals}")

    def widgets(self, values: dict) -> None:
        """Compact one-block dump of widget values (skip defaults)."""
        if not self.enabled:
            return
        non_default = {}
        for k, v in values.items():
            if isinstance(v, float):
                if abs(v - 1.0) < 1e-6 and ("scale" in k.lower()):
                    continue
                if abs(v) < 1e-6 and ("offset" in k.lower() or "rotation" in k.lower()):
                    continue
            non_default[k] = v
        _write(f"{self._prefix()}   widgets (non-default only): {len(non_default)}/{len(values)}")
        for k, v in non_default.items():
            _write(f"{self._prefix()}     {k} = {_fmt_val(v)}")

    def user_action(self, action: str, payload: Optional[dict] = None) -> None:
        """Record a JS-originated user action."""
        if not self.enabled:
            return
        _write(f"{self._prefix()} USER_ACTION: {action}")
        if payload:
            for k, v in payload.items():
                _write(f"{self._prefix()}     {k} = {_fmt_val(v)}")


def get_logger(node: str, enabled: bool) -> _NodeLogger:
    return _NodeLogger(node, enabled)


def session_path() -> Optional[str]:
    return _SESSION_PATH


def log_user_action(node: str, action: str, payload: Optional[dict] = None) -> None:
    """Called by the REST endpoint when the JS side posts an action.

    Always records (no per-node enable gate) because the JS side only posts
    when its node's debug_log is on. Ensures the session file exists.
    """
    _ensure_session()
    ts = _dt.datetime.now().strftime("%H:%M:%S.%f")[:-3]
    prefix = f"[{ts}] [{node:<10}]"
    _write(f"{prefix} USER_ACTION: {action}")
    if payload:
        for k, v in payload.items():
            _write(f"{prefix}     {k} = {_fmt_val(v)}")
