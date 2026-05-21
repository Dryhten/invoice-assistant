from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import UploadFile

from .config import Settings

ALLOWED_EXTENSIONS = {".pdf"}


def validate_upload(file: UploadFile, settings: Settings) -> str:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise ValueError("仅支持带文本层的 PDF 发票")
    return suffix


async def save_upload_to_temp(file: UploadFile, settings: Settings, suffix: str) -> Path:
    total = 0
    handle = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    path = Path(handle.name)
    try:
        with handle:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > settings.max_upload_bytes:
                    raise ValueError(f"文件超过 {settings.max_upload_mb}MB 限制")
                handle.write(chunk)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()
    return path


def extract_pdf_text(path: Path) -> str:
    import pypdfium2 as pdfium

    texts: list[str] = []
    pdf = pdfium.PdfDocument(path)
    try:
        for page in pdf:
            textpage = page.get_textpage()
            try:
                text = textpage.get_text_range()
            finally:
                textpage.close()
            if text:
                texts.append(text)
    finally:
        pdf.close()
    return "\n".join(texts)
