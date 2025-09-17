"""
Clean and normalize extracted PDF text.
Input: data_processed/raw_pages/*.jsonl
Output: data_processed/cleaned/*.jsonl
Each line: {"domain", "file", "page", "text"}
"""

import os
import json
import re
from pathlib import Path
from tqdm import tqdm
from utils import ensure_dir, log

RAW_DIR = Path("data_processed/raw_pages")
CLEAN_DIR = Path("data_processed/cleaned")
ensure_dir(CLEAN_DIR)

def clean_text(text: str) -> str:
    """Normalize extracted PDF text"""
    # Remove multiple spaces & tabs
    text = re.sub(r"\s+", " ", text)
    # Remove page headers/footers if any patterns are known
    # e.g., remove lines like "Page 1 of 10"
    text = re.sub(r"Page \d+ of \d+", "", text, flags=re.IGNORECASE)
    # Strip leading/trailing spaces
    text = text.strip()
    return text

def process_file(file_path: Path):
    out_records = []
    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            rec = json.loads(line)
            text = rec.get("text", "")
            if text.strip():  # skip completely empty pages
                rec["text"] = clean_text(text)
                out_records.append(rec)
    return out_records

def write_jsonl(records, out_path):
    with open(out_path, "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

if __name__ == "__main__":
    total_pages = 0
    for file_path in tqdm(list(RAW_DIR.glob("*.jsonl")), desc="Cleaning files"):
        log(f"Processing {file_path.name}")
        cleaned = process_file(file_path)
        out_path = CLEAN_DIR / file_path.name
        write_jsonl(cleaned, out_path)
        total_pages += len(cleaned)
        log(f"[OK] {file_path.name}: {len(cleaned)} pages → {out_path}")

    log(f"=== Cleaning complete. Total pages: {total_pages} ===")
