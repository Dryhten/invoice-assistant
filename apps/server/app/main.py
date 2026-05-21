from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .extraction import summarize_amount
from .pdf_text import extract_pdf_text, save_upload_to_temp, validate_upload

settings = get_settings()
logger = logging.getLogger("invoice_assistant")
app = FastAPI(title="Invoice Assistant API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        f"http://127.0.0.1:{settings.web_port}",
        f"http://localhost:{settings.web_port}",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, Any]:
    settings = get_settings()
    return {
        "status": "ok",
        "extractor": {
            "engine": "pypdfium2",
            "source": "pdf_text",
        },
    }


@app.post("/api/invoices/extract-amount")
async def invoice_extract_amount(file: UploadFile = File(...)) -> dict[str, Any]:
    settings = get_settings()
    temp_path: Path | None = None
    started_at = time.perf_counter()
    try:
        suffix = validate_upload(file, settings)
        temp_path = await save_upload_to_temp(file, settings, suffix)
        raw_text = await asyncio.wait_for(
            asyncio.to_thread(extract_pdf_text, temp_path),
            timeout=settings.pdf_text_request_timeout_ms / 1000,
        )
        source = "pdf_text"
        summary = summarize_amount({"text": raw_text})
        results = [{"source": source, "text": raw_text}]
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        logger.info(
            "invoice_pdf_text filename=%s source=%s status=%s amount=%s candidates=%s elapsed_ms=%s",
            file.filename,
            source,
            summary["status"],
            summary["amount"],
            len(summary["candidates"]),
            elapsed_ms,
        )
        return {
            **summary,
            "source": source,
            "elapsedMs": elapsed_ms,
            "extractor": {"count": len(results), "source": source, "results": results},
        }
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=504, detail="PDF 文本提取超时") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("PDF text extraction failed")
        raise HTTPException(status_code=502, detail=f"PDF 文本提取失败：{exc}") from exc
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
