import os
import json
from ruamel.yaml import YAML

def ensure_dir(path):
    os.makedirs(path, exist_ok=True)

def load_cfg(path="config.yaml"):
    yaml = YAML()
    with open(path, "r", encoding="utf-8") as f:
        return yaml.load(f)

def log(msg):
    print(msg)

def write_jsonl(records, out_path):
    with open(out_path, "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
