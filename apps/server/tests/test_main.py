import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app


client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated_invoice_stats(monkeypatch, tmp_path) -> None:
    settings = get_settings().model_copy(update={"invoice_stats_path": tmp_path / "invoice_stats.json"})
    monkeypatch.setattr("app.main.get_settings", lambda: settings)


def test_health_endpoint() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_invoice_stats_endpoint_starts_at_zero() -> None:
    response = client.get("/api/invoices/stats")

    assert response.status_code == 200
    assert response.json() == {"processedInvoices": 0, "updatedAt": None}


def test_extract_amount_rejects_non_pdf_upload() -> None:
    response = client.post(
        "/api/invoices/extract-amount",
        files={"file": ("invoice.txt", b"not a pdf", "text/plain")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "仅支持带文本层的 PDF 发票"


def test_extract_amount_returns_summary_from_pdf_text(monkeypatch) -> None:
    monkeypatch.setattr("app.main.extract_pdf_qr_payloads", lambda _path: [])
    monkeypatch.setattr(
        "app.main.extract_pdf_text",
        lambda _path: "价税合计（大写）捌拾伍圆捌角陆分 （小写）¥85.86",
    )

    response = client.post(
        "/api/invoices/extract-amount",
        files={"file": ("invoice.pdf", b"%PDF-1.4", "application/pdf")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "recognized"
    assert payload["amount"] == "85.86"
    assert payload["amountUppercase"] == "捌拾伍圆捌角陆分"
    assert payload["source"] == "pdf_text"
    assert payload["extractor"]["count"] == 1
    assert payload["stats"]["processedInvoices"] == 1

    stats_response = client.get("/api/invoices/stats")

    assert stats_response.status_code == 200
    assert stats_response.json()["processedInvoices"] == 1


def test_extract_amount_prefers_qr_code_amount(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.main.extract_pdf_qr_payloads",
        lambda _path: ["01,32,,26427000000375586818,10.70,20260430,,FAFB"],
    )

    def fail_extract_pdf_text(_path):
        raise AssertionError("PDF text extraction should not run when QR code amount is recognized")

    monkeypatch.setattr("app.main.extract_pdf_text", fail_extract_pdf_text)

    response = client.post(
        "/api/invoices/extract-amount",
        files={"file": ("invoice.pdf", b"%PDF-1.4", "application/pdf")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "recognized"
    assert payload["amount"] == "10.70"
    assert payload["amountUppercase"] == "壹拾圆零柒角整"
    assert payload["source"] == "qr_code"
    assert payload["extractor"]["results"] == [
        {"source": "qr_code", "text": "01,32,,26427000000375586818,10.70,20260430,,FAFB"}
    ]


def test_extract_amount_falls_back_when_qr_payload_is_unexpected(monkeypatch) -> None:
    monkeypatch.setattr("app.main.extract_pdf_qr_payloads", lambda _path: ["普通发票 发票号码 123"])
    monkeypatch.setattr(
        "app.main.extract_pdf_text",
        lambda _path: "价税合计（大写）伍拾陆圆整 （小写）¥56.00",
    )

    response = client.post(
        "/api/invoices/extract-amount",
        files={"file": ("invoice.pdf", b"%PDF-1.4", "application/pdf")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "recognized"
    assert payload["amount"] == "56.00"
    assert payload["source"] == "pdf_text"


def test_extract_amount_falls_back_when_qr_amounts_conflict(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.main.extract_pdf_qr_payloads",
        lambda _path: [
            "01,32,,26427000000375586818,10.70,20260430,,FAFB",
            "01,51,,26339132621000219582,56.00,20260423,,219a",
        ],
    )
    monkeypatch.setattr(
        "app.main.extract_pdf_text",
        lambda _path: "价税合计（大写）壹拾圆柒角整 （小写）¥10.70",
    )

    response = client.post(
        "/api/invoices/extract-amount",
        files={"file": ("invoice.pdf", b"%PDF-1.4", "application/pdf")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "recognized"
    assert payload["amount"] == "10.70"
    assert payload["source"] == "pdf_text"
    assert payload["extractor"]["results"] == [
        {"source": "qr_code", "text": "01,32,,26427000000375586818,10.70,20260430,,FAFB"},
        {"source": "qr_code", "text": "01,51,,26339132621000219582,56.00,20260423,,219a"},
        {"source": "pdf_text", "text": "价税合计（大写）壹拾圆柒角整 （小写）¥10.70"},
    ]
