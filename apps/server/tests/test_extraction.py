from app.extraction import collect_texts, parse_invoice_qr_amount, summarize_amount, summarize_qr_amount


def test_collect_nested_texts() -> None:
    payload = {"a": ["发票", {"b": "价税合计（大写）捌拾伍圆捌角陆分"}], "n": 123}
    assert collect_texts(payload) == ["发票", "价税合计（大写）捌拾伍圆捌角陆分"]


def test_summarize_unique_uppercase_amount() -> None:
    summary = summarize_amount(
        {
            "results": [
                {"text": "货物服务名称 金额 92.62"},
                {"text": "价税合计（大写）捌拾伍圆捌角陆分 （小写）¥85.86"},
            ]
        }
    )
    assert summary["status"] == "recognized"
    assert summary["amount"] == "85.86"
    assert summary["amountUppercase"] == "捌拾伍圆捌角陆分"


def test_parse_invoice_qr_amount_from_expected_payload() -> None:
    candidate = parse_invoice_qr_amount("01,32,,26427000000375586818,10.70,20260430,,FAFB")

    assert candidate is not None
    assert candidate.amount == "10.70"
    assert candidate.amount_uppercase == "壹拾圆零柒角整"


def test_summarize_qr_amount_recognizes_sample_payload() -> None:
    summary = summarize_qr_amount(["01,51,,26339132621000219582,56.00,20260423,,219a"])

    assert summary is not None
    assert summary["status"] == "recognized"
    assert summary["amount"] == "56.00"
    assert summary["amountUppercase"] == "伍拾陆圆整"


def test_summarize_qr_amount_rejects_unexpected_payload() -> None:
    assert summarize_qr_amount(["普通发票 发票号码 123"]) is None


def test_summarize_qr_amount_rejects_invalid_amount_field() -> None:
    assert summarize_qr_amount(["01,32,,26427000000375586818,10.701,20260430,,FAFB"]) is None


def test_summarize_qr_amount_rejects_conflicting_amounts() -> None:
    summary = summarize_qr_amount(
        [
            "01,32,,26427000000375586818,10.70,20260430,,FAFB",
            "01,51,,26339132621000219582,56.00,20260423,,219a",
        ]
    )

    assert summary is None


def test_summarize_conflicting_amounts_needs_review() -> None:
    summary = summarize_amount(
        {
            "results": [
                {"text": "价税合计（大写）捌拾伍圆捌角陆分"},
                {"text": "人民币壹佰元整"},
            ]
        }
    )
    assert summary["status"] == "needs_review"
    assert summary["amount"] is None


def test_summarize_missing_amount_needs_review() -> None:
    summary = summarize_amount({"results": [{"text": "普通发票 发票号码 123"}]})
    assert summary["status"] == "needs_review"
    assert summary["candidates"] == []
