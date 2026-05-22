from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from .amount import AMOUNT_CHARS, chinese_amount_to_decimal, decimal_to_chinese_amount, normalize_amount_string


KEYWORD_WEIGHT = {
    "价税合计": 8,
    "價稅合計": 8,
    "大写": 6,
    "大寫": 6,
    "合计": 4,
    "合計": 4,
    "人民币": 3,
    "人民幣": 3,
}


@dataclass(frozen=True)
class AmountCandidate:
    text: str
    amount: str
    amount_uppercase: str
    score: int


def parse_invoice_qr_amount(payload: str) -> AmountCandidate | None:
    parts = [part.strip() for part in payload.split(",")]
    if len(parts) < 6:
        return None

    amount_text = parts[4]
    if not re.fullmatch(r"\d+(?:\.\d{1,2})?", amount_text):
        return None

    try:
        amount = normalize_amount_string(Decimal(amount_text))
    except Exception:
        return None

    if amount == "0.00":
        return None

    return AmountCandidate(
        text=payload.strip(),
        amount=amount,
        amount_uppercase=decimal_to_chinese_amount(amount),
        score=100,
    )


def find_qr_amount_candidates(payloads: list[str]) -> list[AmountCandidate]:
    candidates: dict[str, AmountCandidate] = {}
    for payload in payloads:
        candidate = parse_invoice_qr_amount(payload)
        if candidate is None:
            continue
        candidates[candidate.text] = candidate
    return list(candidates.values())


def summarize_qr_amount(payloads: list[str]) -> dict[str, Any] | None:
    candidates = find_qr_amount_candidates(payloads)
    unique_amounts = {candidate.amount for candidate in candidates}

    if len(unique_amounts) != 1 or not candidates:
        return None

    best = candidates[0]
    raw_text = "\n".join(payloads)
    return {
        "status": "recognized",
        "amount": best.amount,
        "amountText": best.text,
        "amountUppercase": best.amount_uppercase,
        "candidates": [candidate.__dict__ for candidate in candidates],
        "rawText": raw_text,
    }


def collect_texts(data: Any) -> list[str]:
    texts: list[str] = []

    def visit(value: Any) -> None:
        if value is None:
            return
        if isinstance(value, str):
            normalized = " ".join(value.split())
            if normalized:
                texts.append(normalized)
            return
        if isinstance(value, (int, float, bool)):
            return
        if isinstance(value, dict):
            for item in value.values():
                visit(item)
            return
        if isinstance(value, (list, tuple)):
            for item in value:
                visit(item)

    visit(data)
    return texts


def _candidate_score(text: str) -> int:
    score = 0
    for keyword, weight in KEYWORD_WEIGHT.items():
        if keyword in text:
            score += weight
    score += min(len(re.findall(f"[{AMOUNT_CHARS}]", text)), 18)
    return score


def _extract_amount_like_segments(text: str) -> list[str]:
    compact = re.sub(r"\s+", "", text)
    pattern = re.compile(rf"(?:人民币|人民幣)?[{AMOUNT_CHARS}]{{2,}}(?:元|圆)?[{AMOUNT_CHARS}]*(?:整|正|角|分)?")
    return [match.group(0) for match in pattern.finditer(compact)]


def find_amount_candidates(data: Any) -> tuple[list[AmountCandidate], str]:
    texts = collect_texts(data)
    raw_text = "\n".join(texts)
    candidates: dict[str, AmountCandidate] = {}

    search_units = texts + [raw_text]
    for unit in search_units:
        if not re.search(f"[{AMOUNT_CHARS}]", unit):
            continue
        base_score = _candidate_score(unit)
        for segment in _extract_amount_like_segments(unit):
            try:
                amount_decimal: Decimal = chinese_amount_to_decimal(segment)
            except ValueError:
                continue
            amount = normalize_amount_string(amount_decimal)
            if amount == "0.00":
                continue
            candidate = AmountCandidate(
                text=segment,
                amount=amount,
                amount_uppercase=decimal_to_chinese_amount(amount),
                score=base_score + _candidate_score(segment),
            )
            previous = candidates.get(candidate.text)
            if previous is None or candidate.score > previous.score:
                candidates[candidate.text] = candidate

    ordered = sorted(candidates.values(), key=lambda item: item.score, reverse=True)
    return ordered, raw_text


def summarize_amount(data: Any) -> dict[str, Any]:
    candidates, raw_text = find_amount_candidates(data)
    unique_amounts = {candidate.amount for candidate in candidates}

    if len(unique_amounts) == 1 and candidates:
        best = candidates[0]
        return {
            "status": "recognized",
            "amount": best.amount,
            "amountText": best.text,
            "amountUppercase": best.amount_uppercase,
            "candidates": [candidate.__dict__ for candidate in candidates],
            "rawText": raw_text,
        }

    return {
        "status": "needs_review",
        "amount": None,
        "amountText": candidates[0].text if candidates else None,
        "amountUppercase": None,
        "candidates": [candidate.__dict__ for candidate in candidates],
        "rawText": raw_text,
    }
