"""
Extract text from PDFs in data_raw/* into data_processed/raw_pages/*.jsonl
Each line: {"domain","file","page","text"}
"""

import os
from pathlib import Path
import pdfplumber
from tqdm import tqdm
from utils import ensure_dir, load_cfg, log, write_jsonl

def pdf_paths_for_domain(raw_root: str, domain: str, files: list[str]):
    """Return list of Path objects for existing PDFs in a domain folder"""
    domain_dir = Path(raw_root) / domain
    found = []
    for fname in files:
        p = domain_dir / fname
        if p.exists():
            found.append(p)
        else:
            log(f"[WARN] Missing: {p}")
    return found

def extract_pdf(pdf_path: Path):
    """Extract text from each page of a PDF"""
    pages = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            pages.append({
                "page": i,
                "text": text
            })
    return pages

if __name__ == "__main__":
    cfg = load_cfg()  
    raw_root = cfg["paths"]["raw"]
    out_dir = os.path.join(cfg["paths"]["processed"], "raw_pages")
    ensure_dir(out_dir)

    total_records = 0

    for domain, files in cfg["files"].items():
        log(f"== Extracting domain: {domain} ==")
        pdfs = pdf_paths_for_domain(raw_root, domain, files)

        for p in tqdm(pdfs, desc=f"{domain}"):
            records = []
            pages = extract_pdf(p)
            for rec in pages:
                records.append({
                    "domain": domain,
                    "file": p.name,
                    "page": rec["page"],
                    "text": rec["text"]
                })

            out_path = os.path.join(out_dir, f"{domain}__{p.stem}.jsonl")
            write_jsonl(records, out_path)
            total_records += len(records)
            log(f"[OK] {p.name}: {len(records)} pages → {out_path}")

    log(f"=== PDF extraction complete. Total page records: {total_records} ===")
