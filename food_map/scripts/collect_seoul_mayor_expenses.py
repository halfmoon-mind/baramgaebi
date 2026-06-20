#!/usr/bin/env python3
"""Download and normalize Seoul mayor business expense disclosures."""

from __future__ import annotations

import argparse
import csv
import html
import os
import re
import time
from dataclasses import dataclass
from io import StringIO
from pathlib import Path
from typing import Iterable
from urllib.parse import parse_qs, quote, unquote, urljoin, urlparse
from urllib.request import Request, build_opener

import pandas as pd
from lxml import html as lxml_html


BASE_URL = "https://opengov.seoul.go.kr"
ROOT = Path(__file__).resolve().parents[1]
RAW_HTML_DIR = ROOT / "data" / "raw_html"
RAW_ATTACHMENT_DIR = ROOT / "data" / "raw_attachments"
PROCESSED_DIR = ROOT / "data" / "processed"

LIST_START_URLS = [
    (
        "dept_6110001",
        BASE_URL
        + "/expense/list?dept%5B0%5D=6110000&dept%5B1%5D=6110001"
        + "&ym%5Byear%5D=all&ym%5Bmonth%5D=all&items_per_page=50",
    ),
    (
        "search_seoul_special_mayor",
        BASE_URL
        + "/expense/list?ym%5Byear%5D=all&ym%5Bmonth%5D=all"
        + "&searchKeyword="
        + quote("서울특별시장")
        + "&items_per_page=50",
    ),
    (
        "search_mayor_office",
        BASE_URL
        + "/expense/list?ym%5Byear%5D=all&ym%5Bmonth%5D=all"
        + "&searchKeyword="
        + quote("시장실")
        + "&items_per_page=50",
    ),
]
for _year in range(2008, 2027):
    for _month in range(1, 13):
        LIST_START_URLS.append(
            (
                f"monthly_mayor_{_year}_{_month:02d}",
                BASE_URL
                + f"/expense/list?ym%5Byear%5D={_year}&ym%5Bmonth%5D={_month}"
                + "&searchKeyword="
                + quote("시장")
                + "&items_per_page=50",
            )
        )

MAYOR_TITLE_RE = re.compile(
    r"(서울특별시장.*업무추진비|서울시본청(?:[_\s]+)시장실(?:[_\s]+)업무추진비)"
)
YEAR_MONTH_RE = re.compile(r"(?P<year>\d{4})년\s*(?P<month>\d{1,2})월")
NID_RE = re.compile(r"/expense/(\d+)")
WHITESPACE_RE = re.compile(r"\s+")

HEADER_PATTERNS = {
    "expense_no": [r"^연번$", r"번호"],
    "spent_at_raw": [r"집행일시", r"사용일시", r"집행일자", r"사용일자", r"일시"],
    "place_raw": [r"집행장소", r"사용장소", r"장소", r"업소"],
    "purpose": [r"집행목적", r"사용목적", r"목적", r"내용"],
    "amount_krw": [r"집행금액", r"사용금액", r"금액"],
    "people": [r"대상인원", r"참석인원", r"인원"],
    "payment_method": [r"결제방법", r"결재방법", r"지급방법", r"방법"],
    "expense_category": [r"집행구분", r"업무추진비\s*구분", r"구분"],
}

HEADER_SCORE_KEYS = [
    "집행일시",
    "사용일시",
    "집행장소",
    "사용장소",
    "집행목적",
    "사용목적",
    "집행금액",
    "사용금액",
]

DIRECT_FOOD_KEYWORDS = [
    "오찬",
    "만찬",
    "조찬",
    "식사",
    "식비",
    "다과",
    "간식",
    "음료",
    "차담",
    "티타임",
    "커피",
    "카페",
    "도시락",
    "케이터링",
    "급식",
]

MEETING_FOOD_KEYWORDS = [
    "간담회",
    "간담",
    "업무협의",
    "정책협의",
    "현안논의",
    "논의",
    "의견청취",
    "소통",
    "격려",
]

PLACE_FOOD_KEYWORDS = [
    "식당",
    "음식",
    "한식",
    "일식",
    "중식",
    "양식",
    "뷔페",
    "레스토랑",
    "커피",
    "카페",
    "베이커리",
    "도시락",
    "분식",
    "치킨",
    "피자",
    "초밥",
    "참치",
    "갈비",
    "고기",
    "구이",
    "국수",
    "냉면",
    "곰탕",
    "삼계탕",
    "면옥",
]

HARD_NON_FOOD_KEYWORDS = [
    "화환",
    "조화",
    "화분",
    "경조",
    "축의",
    "조의",
    "부의",
    "근조",
    "위로금",
    "격려금",
    "상품권",
    "기념품",
    "선물",
    "방문기념",
    "홍보물",
    "현수막",
    "책자",
    "자료집",
    "인쇄",
    "우편",
    "택배",
    "배송",
    "발송",
    "수수료",
    "연회비",
    "회비",
    "임차",
    "대여",
    "숙박",
    "주차",
    "통행료",
    "설치비",
]


@dataclass
class Document:
    nid: str
    title: str
    published_date: str
    list_sources: str
    source_url: str
    expense_year: str
    expense_month: str


def clean_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and pd.isna(value):
        return ""
    text = html.unescape(str(value)).replace("\xa0", " ")
    return WHITESPACE_RE.sub(" ", text).strip()


def fetch_bytes(url: str, *, retries: int = 3) -> bytes:
    opener = build_opener()
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            request = Request(
                url,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/125.0 Safari/537.36"
                    )
                },
            )
            with opener.open(request, timeout=60) as response:
                return response.read()
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt < retries:
                time.sleep(1.5 * attempt)
    raise RuntimeError(f"failed to fetch {url}: {last_error}")


def fetch_text(url: str) -> str:
    return fetch_bytes(url).decode("utf-8", errors="replace")


def save_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def parse_list_page(page_html: str, source_label: str) -> tuple[list[dict[str, str]], list[str]]:
    tree = lxml_html.fromstring(page_html)
    rows: list[dict[str, str]] = []
    for tr in tree.xpath("//table[contains(@class, 'views-table')]//tbody/tr"):
        link_nodes = tr.xpath(".//td[contains(@class, 'data-title')]//a")
        if not link_nodes:
            continue
        link = link_nodes[0]
        href = link.get("href") or ""
        match = NID_RE.search(href)
        if not match:
            continue
        date_nodes = tr.xpath(".//td[contains(@class, 'data-date')]/text()")
        rows.append(
            {
                "nid": match.group(1),
                "title": clean_text(link.text_content()),
                "published_date": clean_text(date_nodes[0]) if date_nodes else "",
                "source_url": urljoin(BASE_URL, href),
                "list_source": source_label,
            }
        )

    pager_urls = []
    for href in tree.xpath("//ul[contains(@class, 'pager')]//a/@href"):
        full_url = urljoin(BASE_URL, href)
        if "/expense/list" in full_url:
            pager_urls.append(full_url)
    return rows, pager_urls


def collect_documents() -> list[Document]:
    RAW_HTML_DIR.mkdir(parents=True, exist_ok=True)
    seen_pages: set[str] = set()
    queue = list(LIST_START_URLS)
    by_nid: dict[str, dict[str, str]] = {}
    source_map: dict[str, set[str]] = {}

    while queue:
        source_label, url = queue.pop(0)
        if url in seen_pages:
            continue
        seen_pages.add(url)
        print(f"list page {len(seen_pages)}: {source_label} {url}")
        page_html = fetch_text(url)
        page_id = re.sub(r"[^A-Za-z0-9_.-]+", "_", source_label + "_" + urlparse(url).query)[:180]
        save_text(RAW_HTML_DIR / "list" / f"{page_id}.html", page_html)
        rows, pager_urls = parse_list_page(page_html, source_label)
        for row in rows:
            if not MAYOR_TITLE_RE.search(row["title"]):
                continue
            by_nid.setdefault(row["nid"], row)
            source_map.setdefault(row["nid"], set()).add(row["list_source"])
        for pager_url in pager_urls:
            if pager_url not in seen_pages:
                queue.append((source_label, pager_url))
        time.sleep(0.2)

    docs: list[Document] = []
    for nid, row in by_nid.items():
        ym_match = YEAR_MONTH_RE.search(row["title"])
        docs.append(
            Document(
                nid=nid,
                title=row["title"],
                published_date=row["published_date"],
                list_sources=";".join(sorted(source_map.get(nid, set()))),
                source_url=row["source_url"],
                expense_year=ym_match.group("year") if ym_match else "",
                expense_month=ym_match.group("month") if ym_match else "",
            )
        )
    docs.sort(key=lambda item: (item.expense_year, item.expense_month.zfill(2), item.nid), reverse=True)
    return docs


def extract_attachment_links(detail_html: str) -> list[dict[str, str]]:
    tree = lxml_html.fromstring(detail_html)
    links = []
    for node in tree.xpath("//ul[contains(@class, 'list-attachment')]//a[contains(@href, '/og/com/download.php')]"):
        href = node.get("href") or ""
        full_url = urljoin(BASE_URL, href)
        query = parse_qs(urlparse(full_url).query)
        dname = query.get("dname", [""])[0]
        uri = query.get("uri", [""])[0]
        fid = query.get("fid", [""])[0]
        filename = unquote(dname or os.path.basename(uri) or f"attachment_{fid}")
        links.append(
            {
                "download_url": full_url,
                "filename": clean_text(filename),
                "fid": fid,
                "uri": uri,
            }
        )
    return links


def safe_filename(name: str) -> str:
    name = re.sub(r"[\\/:*?\"<>|]+", "_", name)
    name = WHITESPACE_RE.sub("_", name)
    return name[:160].strip("._") or "attachment"


def download_attachments(doc: Document, links: list[dict[str, str]]) -> list[dict[str, str]]:
    downloaded = []
    for index, link in enumerate(links, start=1):
        suffix = Path(link["filename"]).suffix.lower()
        if suffix not in {".xlsx", ".xls", ".csv"}:
            continue
        ym = f"{doc.expense_year}{doc.expense_month.zfill(2)}" if doc.expense_year and doc.expense_month else "unknown"
        name = f"{ym}_{doc.nid}_{link.get('fid') or index}_{safe_filename(link['filename'])}"
        if not Path(name).suffix:
            name += suffix or ".xlsx"
        path = RAW_ATTACHMENT_DIR / name
        if not path.exists() or path.stat().st_size == 0:
            print(f"download attachment: {doc.nid} {link['filename']}")
            data = fetch_bytes(link["download_url"])
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            time.sleep(0.2)
        downloaded.append({**link, "local_path": str(path.relative_to(ROOT))})
    return downloaded


def normalize_header(text: str) -> str:
    return clean_text(text).replace(" ", "")


def find_header_row(df: pd.DataFrame) -> int | None:
    best_idx = None
    best_score = 0
    for idx in range(min(len(df), 40)):
        values = [normalize_header(value) for value in df.iloc[idx].tolist()]
        row_text = " ".join(values)
        score = sum(1 for key in HEADER_SCORE_KEYS if key in row_text)
        if score > best_score:
            best_score = score
            best_idx = idx
    return best_idx if best_score >= 3 else None


def build_headers(df: pd.DataFrame, header_idx: int) -> tuple[list[str], int]:
    base = [clean_text(value) for value in df.iloc[header_idx].tolist()]
    data_start = header_idx + 1
    if header_idx + 1 < len(df):
        below = [clean_text(value) for value in df.iloc[header_idx + 1].tolist()]
        below_text = " ".join(below)
        parenthetical_count = sum(1 for value in below if value.startswith("(") and value.endswith(")"))
        if parenthetical_count or ("주소" in below_text and "집행일시" not in below_text):
            base = [clean_text(f"{a} {b}") if b else a for a, b in zip(base, below)]
            data_start += 1
    headers = []
    for idx, value in enumerate(base):
        value = clean_text(value) or f"column_{idx + 1}"
        headers.append(value)
    return headers, data_start


def map_columns(headers: list[str]) -> dict[str, int]:
    mapping: dict[str, int] = {}
    normalized = [normalize_header(header) for header in headers]
    for target, patterns in HEADER_PATTERNS.items():
        for idx, header in enumerate(normalized):
            if any(re.search(pattern, header) for pattern in patterns):
                mapping[target] = idx
                break
    return mapping


def amount_to_int(value: object) -> int | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, (int, float)) and not pd.isna(value):
        return int(round(float(value)))
    text = clean_text(value)
    if not text:
        return None
    numbers = re.findall(r"-?\d[\d,]*", text)
    if not numbers:
        return None
    return int(numbers[-1].replace(",", ""))


def parse_spent_date(value: object) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    parsed = pd.to_datetime(value, errors="coerce")
    if pd.notna(parsed):
        return parsed.strftime("%Y-%m-%d")
    text = clean_text(value)
    match = re.search(r"(\d{4})[.\-/년 ]+(\d{1,2})[.\-/월 ]+(\d{1,2})", text)
    if match:
        return f"{int(match.group(1)):04d}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"
    return ""


def looks_like_address(text: str) -> bool:
    return bool(
        re.search(
            r"서울|경기|인천|부산|대구|광주|대전|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주|"
            r"특별시|광역시|[가-힣]+구|[가-힣]+군|[가-힣]+시|[가-힣]+동|로\s*\d|길\s*\d|번지",
            text,
        )
    )


def split_place(raw_value: object) -> tuple[str, str]:
    raw = clean_text(raw_value)
    if not raw:
        return "", ""

    lines = [clean_text(line) for line in str(raw_value).replace("\r", "\n").split("\n") if clean_text(line)]
    if len(lines) >= 2 and looks_like_address(lines[-1]):
        return clean_text(" ".join(lines[:-1])), lines[-1].strip("() ")

    paren_matches = list(re.finditer(r"\(([^()]*)\)", raw))
    for match in reversed(paren_matches):
        candidate = clean_text(match.group(1))
        if candidate and looks_like_address(candidate):
            merchant = clean_text((raw[: match.start()] + " " + raw[match.end() :]).strip())
            return merchant, candidate

    return raw, ""


def find_keyword(text: str, keywords: Iterable[str]) -> str:
    for keyword in keywords:
        if keyword in text:
            return keyword
    return ""


def classify_food(place: str, purpose: str, category: str) -> tuple[bool, str, str]:
    combined = clean_text(f"{place} {purpose} {category}")
    direct = find_keyword(combined, DIRECT_FOOD_KEYWORDS)
    hard_exclude = find_keyword(combined, HARD_NON_FOOD_KEYWORDS)
    if hard_exclude and not direct:
        return False, "", hard_exclude
    if direct:
        return True, direct, hard_exclude

    place_keyword = find_keyword(place, PLACE_FOOD_KEYWORDS)
    if place_keyword:
        return True, place_keyword, hard_exclude

    meeting = find_keyword(combined, MEETING_FOOD_KEYWORDS)
    if meeting and not hard_exclude:
        return True, meeting, ""
    return False, "", hard_exclude


def extract_rows_from_df(df: pd.DataFrame, *, source_name: str, sheet_name: str, doc: Document) -> list[dict[str, object]]:
    header_idx = find_header_row(df)
    if header_idx is None:
        return []
    headers, data_start = build_headers(df, header_idx)
    mapping = map_columns(headers)
    required = {"spent_at_raw", "place_raw", "purpose", "amount_krw"}
    if len(required.intersection(mapping)) < 3:
        return []

    rows: list[dict[str, object]] = []
    for offset, (_, raw_row) in enumerate(df.iloc[data_start:].iterrows(), start=data_start + 1):
        values = raw_row.tolist()
        row_text = clean_text(" ".join(clean_text(value) for value in values))
        if not row_text:
            continue
        if row_text in {"계", "합계"} or row_text.startswith("합계 "):
            continue
        if "집행일시" in row_text and "집행금액" in row_text:
            continue

        def get(target: str) -> object:
            idx = mapping.get(target)
            return values[idx] if idx is not None and idx < len(values) else ""

        amount = amount_to_int(get("amount_krw"))
        spent_at_raw = clean_text(get("spent_at_raw"))
        place_raw = clean_text(get("place_raw"))
        purpose = clean_text(get("purpose"))
        if amount is None and not any([spent_at_raw, place_raw, purpose]):
            continue
        if amount is None and re.search(r"^[\d,\s]+$", row_text):
            continue

        merchant, address = split_place(get("place_raw"))
        is_food, include_keyword, exclude_keyword = classify_food(place_raw, purpose, clean_text(get("expense_category")))
        rows.append(
            {
                "document_nid": doc.nid,
                "document_title": doc.title,
                "document_expense_year": doc.expense_year,
                "document_expense_month": doc.expense_month,
                "document_published_date": doc.published_date,
                "document_source_url": doc.source_url,
                "list_sources": doc.list_sources,
                "source_file": source_name,
                "sheet_name": sheet_name,
                "source_row_number": offset,
                "expense_no": clean_text(get("expense_no")),
                "spent_at_raw": spent_at_raw,
                "spent_date": parse_spent_date(get("spent_at_raw")),
                "place_raw": place_raw,
                "merchant_name": merchant,
                "address": address,
                "purpose": purpose,
                "amount_krw": amount,
                "people": clean_text(get("people")),
                "payment_method": clean_text(get("payment_method")),
                "expense_category": clean_text(get("expense_category")),
                "is_food_related": is_food,
                "food_include_keyword": include_keyword,
                "food_exclude_keyword": exclude_keyword,
            }
        )
    return rows


def parse_attachment(path: Path, doc: Document) -> list[dict[str, object]]:
    suffix = path.suffix.lower()
    if suffix != ".xlsx":
        return []
    parsed: list[dict[str, object]] = []
    try:
        sheets = pd.read_excel(path, sheet_name=None, header=None, dtype=object, engine="openpyxl")
    except Exception as exc:  # noqa: BLE001
        print(f"warning: could not parse {path}: {exc}")
        return []
    for sheet_name, df in sheets.items():
        parsed.extend(
            extract_rows_from_df(
                df,
                source_name=str(path.relative_to(ROOT)),
                sheet_name=clean_text(sheet_name),
                doc=doc,
            )
        )
    return parsed


def parse_detail_html_tables(detail_html: str, doc: Document) -> list[dict[str, object]]:
    try:
        tables = pd.read_html(StringIO(detail_html), flavor="lxml")
    except Exception as exc:  # noqa: BLE001
        print(f"warning: could not parse html tables for {doc.nid}: {exc}")
        return []
    rows: list[dict[str, object]] = []
    for idx, table in enumerate(tables, start=1):
        rows.extend(
            extract_rows_from_df(
                table,
                source_name=f"data/raw_html/detail/{doc.nid}.html",
                sheet_name=f"html_table_{idx}",
                doc=doc,
            )
        )
    return rows


def write_csv(path: Path, rows: list[dict[str, object]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def summarize_places(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    if not rows:
        return []
    df = pd.DataFrame(rows)
    df["amount_krw"] = pd.to_numeric(df["amount_krw"], errors="coerce").fillna(0).astype(int)
    grouped = (
        df.groupby(["merchant_name", "address"], dropna=False)
        .agg(
            transaction_count=("amount_krw", "size"),
            total_amount_krw=("amount_krw", "sum"),
            average_amount_krw=("amount_krw", "mean"),
            first_spent_date=("spent_date", "min"),
            last_spent_date=("spent_date", "max"),
            sample_purpose=("purpose", "first"),
            sample_source_url=("document_source_url", "first"),
        )
        .reset_index()
    )
    grouped["average_amount_krw"] = grouped["average_amount_krw"].round(0).astype(int)
    grouped = grouped.sort_values(["total_amount_krw", "transaction_count"], ascending=[False, False])
    return grouped.to_dict("records")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-download", action="store_true", help="Parse already downloaded files only.")
    args = parser.parse_args()

    for directory in [RAW_HTML_DIR, RAW_ATTACHMENT_DIR, PROCESSED_DIR]:
        directory.mkdir(parents=True, exist_ok=True)

    docs = collect_documents()
    print(f"matched documents: {len(docs)}")

    document_rows = [doc.__dict__ for doc in docs]
    write_csv(
        PROCESSED_DIR / "documents.csv",
        document_rows,
        [
            "nid",
            "title",
            "published_date",
            "list_sources",
            "source_url",
            "expense_year",
            "expense_month",
        ],
    )

    all_rows: list[dict[str, object]] = []
    attachment_rows: list[dict[str, object]] = []
    parse_failures: list[dict[str, object]] = []

    for idx, doc in enumerate(docs, start=1):
        print(f"document {idx}/{len(docs)}: {doc.nid} {doc.title}")
        detail_path = RAW_HTML_DIR / "detail" / f"{doc.nid}.html"
        if args.skip_download and detail_path.exists():
            detail_html = detail_path.read_text(encoding="utf-8")
        else:
            detail_html = fetch_text(doc.source_url)
            save_text(detail_path, detail_html)
            time.sleep(0.2)

        links = extract_attachment_links(detail_html)
        attachments = download_attachments(doc, links) if not args.skip_download else []
        if args.skip_download:
            local_files = sorted(RAW_ATTACHMENT_DIR.glob(f"*_{doc.nid}_*"))
            attachments = [{"local_path": str(path.relative_to(ROOT)), "filename": path.name} for path in local_files]
        attachment_rows.extend({"document_nid": doc.nid, **item} for item in attachments)

        parsed_for_doc: list[dict[str, object]] = []
        for attachment in attachments:
            local_path = ROOT / str(attachment["local_path"])
            parsed_for_doc.extend(parse_attachment(local_path, doc))

        if not parsed_for_doc:
            parsed_for_doc = parse_detail_html_tables(detail_html, doc)

        if not parsed_for_doc:
            parse_failures.append({"document_nid": doc.nid, "title": doc.title, "source_url": doc.source_url})
        all_rows.extend(parsed_for_doc)

    fieldnames = [
        "document_nid",
        "document_title",
        "document_expense_year",
        "document_expense_month",
        "document_published_date",
        "document_source_url",
        "list_sources",
        "source_file",
        "sheet_name",
        "source_row_number",
        "expense_no",
        "spent_at_raw",
        "spent_date",
        "place_raw",
        "merchant_name",
        "address",
        "purpose",
        "amount_krw",
        "people",
        "payment_method",
        "expense_category",
        "is_food_related",
        "food_include_keyword",
        "food_exclude_keyword",
    ]
    dining_rows = [row for row in all_rows if row.get("is_food_related")]
    place_rows = summarize_places(dining_rows)

    write_csv(PROCESSED_DIR / "all_expense_rows.csv", all_rows, fieldnames)
    write_csv(PROCESSED_DIR / "dining_expense_rows.csv", dining_rows, fieldnames)
    write_csv(
        PROCESSED_DIR / "dining_places_summary.csv",
        place_rows,
        [
            "merchant_name",
            "address",
            "transaction_count",
            "total_amount_krw",
            "average_amount_krw",
            "first_spent_date",
            "last_spent_date",
            "sample_purpose",
            "sample_source_url",
        ],
    )
    write_csv(
        PROCESSED_DIR / "attachments.csv",
        attachment_rows,
        ["document_nid", "filename", "fid", "uri", "download_url", "local_path"],
    )
    write_csv(PROCESSED_DIR / "parse_failures.csv", parse_failures, ["document_nid", "title", "source_url"])

    print("summary")
    print(f"documents={len(docs)}")
    print(f"attachments={len(attachment_rows)}")
    print(f"all_rows={len(all_rows)}")
    print(f"dining_rows={len(dining_rows)}")
    print(f"places={len(place_rows)}")
    print(f"parse_failures={len(parse_failures)}")


if __name__ == "__main__":
    main()
