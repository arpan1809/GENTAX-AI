"""
Combine cleaned page-level JSONL into domain-level JSONL/CSV
Input: data_processed/cleaned/*.jsonl
Output: data_processed/structured/<domain>.jsonl and <domain>.csv
"""

import os
import json
import pandas as pd
from pathlib import Path
from tqdm import tqdm
from utils import ensure_dir, log, write_jsonl

CLEAN_DIR = Path("data_processed/cleaned")
STRUCTURED_DIR = Path("data_processed/structured")
ensure_dir(STRUCTURED_DIR)

def combine_pages(file_path: Path):
    """Combine all pages of a PDF/domain into a single text block"""
    combined_records = []
    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            rec = json.loads(line)
            combined_records.append(rec["text"])
    full_text = "\n".join(combined_records)
    return full_text

if __name__ == "__main__":
    total_domains = 0
    for file_path in tqdm(list(CLEAN_DIR.glob("*.jsonl")), desc="Structuring domains"):
        domain_name = file_path.stem.split("__")[0]  # e.g., income_tax__filename -> income_tax
        log(f"Processing domain: {domain_name}")

        # Combine pages into one text
        full_text = combine_pages(file_path)

        # Create domain-level record
        record = {
            "domain": domain_name,
            "file": file_path.name,
            "text": full_text
        }

        # Save as JSONL
        out_jsonl = STRUCTURED_DIR / f"{domain_name}.jsonl"
        write_jsonl([record], out_jsonl)

        # Save as CSV
        out_csv = STRUCTURED_DIR / f"{domain_name}.csv"
        df = pd.DataFrame([record])
        df.to_csv(out_csv, index=False, encoding="utf-8")

        log(f"[OK] Domain structured: {domain_name} → JSONL/CSV")
        total_domains += 1

    log(f"=== Structuring complete. Total domains: {total_domains} ===")
