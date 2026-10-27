"""Ablation table (1.2.0): several trained runs scored on the SAME held-out splits of one data directory, so mixes with
and without NEREL / Nerus and teachers base / large compare on equal terms (each run's own evaluate.py uses its own
data/; synth_genre_test, for example, differs between mixes).

    uv run python ablation.py --data-run x12-full2 --runs x12-base2 x12-nerel x12-full2 x12-nerus40 x12-xl
    -> runs/ablation.json + Markdown table on stdout

Splits: validation_ru / validation_en (WikiANN, model selection), validation_nerel (NEREL dev), test_ru (WikiANN gate),
test_factru, test_synth_genre (+ false ORG on its entity-free sentences). seqeval, PyTorch fp32, argmax of the first
sub-token (as evaluate.py).
"""
from __future__ import annotations

import argparse
import json

from common import ROOT, bio_spans, torch_logits, word_level  # noqa: E402  (sets HF_HOME)
import torch
from datasets import load_from_disk
from seqeval.metrics import classification_report
from transformers import AutoModelForTokenClassification

LABELS = ["O", "B-PER", "I-PER", "B-ORG", "I-ORG", "B-LOC", "I-LOC"]
SPLITS = ["validation_ru", "validation_en", "validation_nerel", "test_ru", "test_factru", "test_synth_genre"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-run", required=True)
    ap.add_argument("--runs", nargs="+", required=True)
    ap.add_argument("--out", default=str(ROOT / "runs" / "ablation.json"))
    args = ap.parse_args()
    data = load_from_disk(str(ROOT / "runs" / args.data_run / "data"))
    device = "cuda" if torch.cuda.is_available() else "cpu"
    res = {"data_run": args.data_run, "runs": {}}
    for run in args.runs:
        model = AutoModelForTokenClassification.from_pretrained(str(ROOT / "runs" / run / "model")).to(device)
        r = {}
        for name in SPLITS:
            if name not in data:
                continue
            split = data[name]
            yt, yp = [], []
            for lg, wid, tags in zip(torch_logits(model, split), split["word_ids"], split["ner_tags"]):
                yp.append(word_level(lg, wid, len(tags), LABELS)[0])
                yt.append([LABELS[t] for t in tags])
            rep = classification_report(yt, yp, output_dict=True, zero_division=0)
            row = {t: round(float(rep[t]["f1-score"]), 4) for t in ("PER", "ORG", "LOC") if t in rep}
            row["micro"] = round(float(rep["micro avg"]["f1-score"]), 4)
            row["ORG_P"] = round(float(rep["ORG"]["precision"]), 4) if "ORG" in rep else None
            if "negative" in split.column_names:
                row["false_org_on_negatives"] = sum(1 for neg, p in zip(split["negative"], yp) if neg
                                                    for s in bio_spans(p) if s[0] == "ORG")
            r[name] = row
        res["runs"][run] = r
        del model
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=2)
    print(f"| run | {' | '.join(s for s in SPLITS if s in data)} |")
    print("|---|" + "---|" * sum(1 for s in SPLITS if s in data))
    for run, r in res["runs"].items():
        cells = []
        for s in SPLITS:
            if s not in r:
                continue
            x = r[s]
            extra = f", ложных ORG {x['false_org_on_negatives']}" if "false_org_on_negatives" in x else ""
            cells.append(f"{x.get('PER', 0):.3f} / {x.get('ORG', 0):.3f} / {x.get('LOC', 0):.3f}{extra}")
        print(f"| {run} | {' | '.join(cells)} |")


if __name__ == "__main__":
    main()
