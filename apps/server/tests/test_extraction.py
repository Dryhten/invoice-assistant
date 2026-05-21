from app.extraction import collect_texts, summarize_amount


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
    assert summary["amountUppercase"] == "捌拾伍元捌角陆分"


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
