import os
import json
import re
from typing import List, Dict, Tuple
from functools import lru_cache

KB_DIR = os.path.join(os.getcwd(), "knowledge_base")

# Basic cleaner
def _clean(text: str) -> str:
    text = text.replace("\u00a0", " ").replace("\n", " ").replace("\t", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text

def _split_into_chunks(text: str, max_len: int = 1200, overlap: int = 150) -> List[str]:
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        end = min(i + max_len, len(words))
        chunk = " ".join(words[i:end])
        chunks.append(chunk)
        if end == len(words):
            break
        i = max(0, end - overlap)
    return chunks

def _tokenize(s: str) -> List[str]:
    return re.findall(r"[a-z0-9]+", s.lower())

def _score(query_tokens: List[str], doc_tokens: List[str]) -> float:
    if not doc_tokens:
        return 0.0
    score = 0.0
    doc_freq = {}
    for t in doc_tokens:
        doc_freq[t] = doc_freq.get(t, 0) + 1
    for qt in query_tokens:
        score += doc_freq.get(qt, 0)
    # length normalization
    score = score / (1.0 + len(doc_tokens) / 5000.0)
    return score

@lru_cache(maxsize=1)
def load_kb() -> List[Dict]:
    items: List[Dict] = []
    if not os.path.isdir(KB_DIR):
        return items

    for fname in os.listdir(KB_DIR):
        if not fname.lower().endswith(".json"):
            continue
        path = os.path.join(KB_DIR, fname)
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except UnicodeDecodeError:
            print(f"Skipping non-UTF8 file: {fname}")
            continue
        except Exception:
            # Sometimes these are large JSON objects with "text" key, or raw arrays
            try:
                with open(path, "r", encoding="utf-8") as f:
                    raw = f.read()
                data = json.loads(raw)
            except Exception:
                # As a last resort, treat the whole file as text
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        text = f.read()
                    data = {"text": text}
                except UnicodeDecodeError:
                    print(f"Skipping non-UTF8 file: {fname}")
                    continue

        corpus_text = ""
        if isinstance(data, dict) and "text" in data:
            corpus_text = str(data["text"])
        else:
            # flatten best-effort
            corpus_text = _clean(json.dumps(data, ensure_ascii=False))

        corpus_text = _clean(corpus_text)
        chunks = _split_into_chunks(corpus_text, max_len=1200, overlap=160)
        for idx, ch in enumerate(chunks):
            items.append({
                "source": fname,
                "chunk_id": idx,
                "text": ch,
                "tokens": _tokenize(ch)
            })
    return items

def retrieve(query: str, k: int = 5, min_chars: int = 250) -> List[Dict]:
    kb = load_kb()
    q_tokens = _tokenize(query)
    if not q_tokens:
        return []
    scored: List[Tuple[float, Dict]] = []
    for item in kb:
        s = _score(q_tokens, item["tokens"])
        if s > 0:
            scored.append((s, item))
    scored.sort(key=lambda x: x[0], reverse=True)
    top = [it for _, it in scored[:max(1, k)]]
    # filter out too-short chunks unless needed
    filtered = [t for t in top if len(t["text"]) >= min_chars]
    return filtered if filtered else top[:k]
