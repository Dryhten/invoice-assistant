from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health_endpoint() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_extract_amount_rejects_non_pdf_upload() -> None:
    response = client.post(
        "/api/invoices/extract-amount",
        files={"file": ("invoice.txt", b"not a pdf", "text/plain")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "仅支持带文本层的 PDF 发票"


def test_extract_amount_returns_summary_from_pdf_text(monkeypatch) -> None:
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
    assert payload["amountUppercase"] == "捌拾伍元捌角陆分"
    assert payload["source"] == "pdf_text"
    assert payload["extractor"]["count"] == 1
