from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .config import Settings

_stats_lock = Lock()
_server_root = Path(__file__).resolve().parents[1]


def _resolve_stats_path(settings: Settings) -> Path:
    path = settings.invoice_stats_path
    if path.is_absolute():
        return path
    return _server_root / path


def _empty_stats() -> dict[str, Any]:
    return {
        "processedInvoices": 0,
        "updatedAt": None,
    }


def _read_stats_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return _empty_stats()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _empty_stats()

    processed_invoices = payload.get("processedInvoices", 0)
    if not isinstance(processed_invoices, int) or processed_invoices < 0:
        processed_invoices = 0
    updated_at = payload.get("updatedAt")
    if not isinstance(updated_at, str):
        updated_at = None

    return {
        "processedInvoices": processed_invoices,
        "updatedAt": updated_at,
    }


def _write_stats_file(path: Path, stats: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(f"{path.suffix}.tmp")
    temp_path.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(path)


def get_invoice_stats(settings: Settings) -> dict[str, Any]:
    path = _resolve_stats_path(settings)
    with _stats_lock:
        return _read_stats_file(path)


def record_processed_invoice(settings: Settings) -> dict[str, Any]:
    path = _resolve_stats_path(settings)
    with _stats_lock:
        stats = _read_stats_file(path)
        stats["processedInvoices"] += 1
        stats["updatedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        _write_stats_file(path, stats)
        return stats
