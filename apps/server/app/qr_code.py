from __future__ import annotations

from pathlib import Path
from typing import Iterable


def _unique_texts(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    texts: list[str] = []
    for value in values:
        text = value.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        texts.append(text)
    return texts


def _decode_qr_from_image(image) -> list[str]:
    import cv2

    detector = cv2.QRCodeDetector()
    decoded: list[str] = []

    ok, decoded_info, _, _ = detector.detectAndDecodeMulti(image)
    if ok:
        decoded.extend(item for item in decoded_info if item)

    single, _, _ = detector.detectAndDecode(image)
    if single:
        decoded.append(single)

    return _unique_texts(decoded)


def extract_pdf_qr_payloads(path: Path, *, max_pages: int = 3) -> list[str]:
    import cv2
    import pypdfium2 as pdfium

    payloads: list[str] = []
    pdf = pdfium.PdfDocument(path)
    try:
        page_count = min(len(pdf), max_pages)
        for page_index in range(page_count):
            page = pdf[page_index]
            try:
                bitmap = page.render(scale=3)
                try:
                    image = bitmap.to_numpy()
                finally:
                    close = getattr(bitmap, "close", None)
                    if close is not None:
                        close()

                payloads.extend(_decode_qr_from_image(image))

                if image.ndim == 3:
                    if image.shape[2] == 4:
                        gray = cv2.cvtColor(image, cv2.COLOR_BGRA2GRAY)
                    else:
                        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
                    payloads.extend(_decode_qr_from_image(gray))
            finally:
                close = getattr(page, "close", None)
                if close is not None:
                    close()
    finally:
        pdf.close()

    return _unique_texts(payloads)
