"""
Build final knowledge base from structured domain files
Input: data_processed/structured/*.jsonl or *.csv
Output: knowledge_base/*.json (one per domain)
"""

import os
import json
import pandas as pd
from pathlib import Path
from utils import ensure_dir, log

STRUCTURED_DIR = Path("data_processed/structured")
KB_DIR = Path("knowledge_base")
ensure_dir(KB_DIR)

def load_domain_file(file_path: Path):
    """Load JSONL or CSV file and return list of records"""
    records = []
    if file_path.suffix == ".jsonl":
        with open(file_path, "r", encoding="utf-8") as f:
            for line in f:
                records.append(json.loads(line))
    elif file_path.suffix == ".csv":
        df = pd.read_csv(file_path, encoding="utf-8")
        records = df.to_dict(orient="records")
    return records

if __name__ == "__main__":
    total_domains = 0
    for file_path in STRUCTURED_DIR.glob("*.*"):
        domain_name = file_path.stem  # e.g., income_tax.jsonl → income_tax
        log(f"Processing domain: {domain_name}")

        records = load_domain_file(file_path)

        # Optional: merge text if multiple records (already combined in step 3)
        if len(records) > 1:
            merged_text = "\n".join([r.get("text", "") for r in records])
            kb_record = {"domain": domain_name, "text": merged_text}
        else:
            kb_record = records[0]

        # Save final KB JSON
        out_path = KB_DIR / f"{domain_name}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(kb_record, f, ensure_ascii=False, indent=2)

        log(f"[OK] Knowledge base saved: {out_path}")
        total_domains += 1

    log(f"=== KB build complete. Total domains: {total_domains} ===")
