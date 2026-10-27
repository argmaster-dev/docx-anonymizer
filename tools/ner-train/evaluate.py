"""Per-class seqeval metrics of the trained PyTorch model -> runs/<run_id>/eval.json (section "metrics") + gates.

Splits: WikiANN ru/en test and validation; held-out parts of other corpora (test_factru, test_nerel,
validation_nerel — informational);
test_synth_genre — held-out genre sentences: ORG precision (gate), PER/ORG/LOC P/R/F1 per genre and the number of
false ORG spans on entity-free (negative) sentences (informational).

heldout_names (1.2.0, concept 0.5 K10): hand-written held-out sentences with foreign names, bare first names and
surnames, one-initial signatures, initials without a space, vocatives and table rows (evaluate.heldout_names files,
`cases[].entities` PERSON values); a gold occurrence is found when every word of it is PER (marginal type probability,
first sub-token, as the extension decodes) with probability >= evaluate.threshold. Recall of this model vs the baseline
model (evaluate.baseline_model, the published 1.1.0) -> gate heldout_names_recall_gain.

--strict: exit code 1 when a non-informational gate fails (for scripts / CI).
"""
from __future__ import annotations

import json
import sys

import re
from pathlib import Path

from common import REPO, ROOT, bio_spans, load_config, run_dir, torch_logits, update_eval, word_level  # noqa: E402
import numpy as np
import torch
from datasets import load_from_disk
from seqeval.metrics import classification_report, f1_score
from transformers import AutoModelForTokenClassification, AutoTokenizer

WORD_RE = re.compile(r"\w+(?:[-']\w+)*|[^\w\s]", re.UNICODE)  # synth.py tokenization


def heldout_cases(files):
    out = []
    for f in files:
        data = json.loads((REPO / f).read_text(encoding="utf-8"))
        for c in data.get("cases", []):
            vals = [e["value"] for e in c.get("entities", []) if e.get("category") == "PERSON"]
            if vals:
                out.append({"id": c["id"], "group": c.get("group") or c.get("source") or Path(f).stem,
                            "text": c["text"], "values": vals})
    return out


def heldout_recall(model_dir, cases, labels, threshold):
    """Share of gold PERSON occurrences whose every word is PER with marginal probability >= threshold."""
    tok = AutoTokenizer.from_pretrained(str(model_dir))
    model = AutoModelForTokenClassification.from_pretrained(str(model_dir)).eval()
    per = [i for i, l in enumerate(labels) if l.endswith("-PER")]
    types = {t: [i for i, l in enumerate(labels) if l.endswith("-" + t)] for t in ("PER", "ORG", "LOC")}
    by_group, missed = {}, []
    for c in cases:
        words = [(m.group(), m.start(), m.end()) for m in WORD_RE.finditer(c["text"])]
        enc = tok([w for w, _, _ in words], is_split_into_words=True, truncation=True, max_length=128, return_tensors="pt")
        with torch.no_grad():
            probs = torch.softmax(model(**enc).logits[0].float(), -1).numpy()
        wtype, prev = {}, None
        for pos, w in enumerate(enc.word_ids(0)):
            if w is None or w == prev:
                prev = w
                continue
            marg = {t: float(probs[pos, idx].sum()) for t, idx in types.items()}
            best = max(marg, key=marg.get)
            o = 1.0 - sum(marg.values())
            wtype[w] = (best, marg[best]) if marg[best] > o else ("O", o)
            prev = w
        for v in c["values"]:
            for m in re.finditer(re.escape(v), c["text"]):
                idx = [i for i, (w, a, b) in enumerate(words) if a < m.end() and b > m.start() and re.search(r"[^\W\d_]", w)]
                ok = all(wtype.get(i, ("O", 1))[0] == "PER" and wtype[i][1] >= threshold for i in idx)
                g = by_group.setdefault(c["group"], [0, 0])
                g[0] += ok
                g[1] += 1
                if not ok:
                    missed.append(f"{c['id']}: {v}")
    found = sum(g[0] for g in by_group.values())
    total = sum(g[1] for g in by_group.values())
    return {"recall": round(found / total, 4) if total else 0.0, "found": found, "total": total,
            "by_group": {k: {"recall": round(a / b, 4), "found": a, "total": b} for k, (a, b) in sorted(by_group.items())},
            "missed": missed}


def predict(model, split, labels, with_logits=False):
    logits = torch_logits(model, split)
    y_true, y_pred = [], []
    for lg, wid, tags in zip(logits, split["word_ids"], split["ner_tags"]):
        pred, _ = word_level(lg, wid, len(tags), labels)
        y_true.append([labels[t] for t in tags])
        y_pred.append(pred)
    return (y_true, y_pred, logits) if with_logits else (y_true, y_pred)


def ext_false_spans(split, logits, thresholds):
    """False spans on entity-free sentences as the extension decodes them (src/core/ner/bio.js decodeWord + mergeBio,
    score = mean marginal probability, per-type thresholds: nerThreshold 0.7, nerThresholdOrg 0.85); before the
    extension's span filters, so an upper bound of what reaches filters.js."""
    from compare_natasha import apply_threshold, merge_bio, words_from_logits
    out = {"PER": 0, "ORG": 0, "LOC": 0}
    for neg, lg, wid, tags in zip(split["negative"], logits, split["word_ids"], split["ner_tags"]):
        if not neg:
            continue
        for t, *_ in apply_threshold(merge_bio(words_from_logits(lg, wid, len(tags))), thresholds):
            out[t] += 1
    return out


def report(y_true, y_pred):
    rep = classification_report(y_true, y_pred, output_dict=True, digits=4, zero_division=0)
    res = {k: {m: round(float(v), 4) for m, v in rep[k].items()} for k in ("PER", "ORG", "LOC", "micro avg") if k in rep}
    res["micro_f1"] = round(float(f1_score(y_true, y_pred)), 4)
    return res


def genre_report(split, y_true, y_pred):
    """Per genre: seqeval report + false ORG spans on entity-free sentences."""
    out = {}
    by_genre = {}
    for g, neg, yt, yp in zip(split["genre"], split["negative"], y_true, y_pred):
        by_genre.setdefault(g, []).append((neg, yt, yp))
    total_neg, total_false_org, total_false_any = 0, 0, 0
    for g, rows in sorted(by_genre.items()):
        yt = [r[1] for r in rows]
        yp = [r[2] for r in rows]
        negs = [r for r in rows if r[0]]
        false_org = sum(1 for _, _, p in negs for s in bio_spans(p) if s[0] == "ORG")
        false_any = sum(len(bio_spans(p)) for _, _, p in negs)
        total_neg += len(negs)
        total_false_org += false_org
        total_false_any += false_any
        out[g] = {"sentences": len(rows), "negative_sentences": len(negs), "false_org_on_negatives": false_org,
                  "false_spans_on_negatives": false_any, **report(yt, yp)}
    return out, {"negative_sentences": total_neg, "false_org_on_negatives": total_false_org,
                 "false_spans_on_negatives": total_false_any}


def main():
    cfg, args = load_config(extra_args=lambda p: p.add_argument(
        "--strict", action="store_true", help="exit with code 1 when a non-informational gate fails"))
    rd = run_dir(cfg)
    labels = cfg["labels"]
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = AutoModelForTokenClassification.from_pretrained(str(rd / "model")).to(device)
    data = load_from_disk(str(rd / "data"))
    names = [n for n in ("test_ru", "test_en", "validation_ru", "validation_en") if n in data]
    names += sorted(n for n in data if (n.startswith("test_") or n.startswith("validation_")) and n not in names
                    and n != "test_synth_genre")
    results = {}
    for name in names:
        results[name] = report(*predict(model, data[name], labels))
    genre = None
    if "test_synth_genre" in data:
        split = data["test_synth_genre"]
        yt, yp, lg = predict(model, split, labels, with_logits=True)
        results["test_synth_genre"] = report(yt, yp)
        by_genre, neg = genre_report(split, yt, yp)
        ext_th = {"PER": 0.7, "ORG": 0.85, "LOC": 0.7, **cfg.get("evaluate", {}).get("ext_thresholds", {})}
        genre = {"by_genre": by_genre, **neg, "ext_thresholds": ext_th,
                 "ext_false_spans_on_negatives": ext_false_spans(split, lg, ext_th)}
    g = cfg["gates"]
    gates = {
        "ru_per_f1": {"value": results["test_ru"]["PER"]["f1-score"], "min": g["ru_per_f1"]},
        "ru_org_f1": {"value": results["test_ru"]["ORG"]["f1-score"], "min": g["ru_org_f1"]},
        "en_per_f1": {"value": results["test_en"]["PER"]["f1-score"], "min": g["en_per_f1"], "informational": True},
    }
    if "synth_genre_org_precision" in g:
        gates["synth_genre_org_precision"] = {
            "value": results["test_synth_genre"]["ORG"]["precision"] if genre else None,
            "min": g["synth_genre_org_precision"]}
    if "synth_genre_false_org_max" in g:
        # 1.2.0: false ORG as the extension decodes it (marginal type, ORG >= nerThresholdOrg 0.85); the argmax count of
        # 1.1.0 stays in metrics.synth_genre.false_org_on_negatives (informational gate below)
        gates["synth_genre_false_org"] = {"value": genre["ext_false_spans_on_negatives"]["ORG"] if genre else None,
                                          "max": g["synth_genre_false_org_max"], "decoding": "extension"}
        gates["synth_genre_false_org_argmax"] = {"value": genre["false_org_on_negatives"] if genre else None,
                                                 "max": g["synth_genre_false_org_max"], "informational": True}
    ev = cfg.get("evaluate", {})
    heldout = None
    if ev.get("heldout_names"):
        cases = heldout_cases(ev["heldout_names"])
        th = float(ev.get("threshold", 0.7))
        heldout = {"files": ev["heldout_names"], "cases": len(cases), "threshold": th,
                   "model": heldout_recall(rd / "model", cases, labels, th)}
        base = ev.get("baseline_model")
        if base and (ROOT / base).exists():
            heldout["baseline"] = {"path": base, **heldout_recall(ROOT / base, cases, labels, th)}
            if "heldout_names_recall_gain" in g:
                gates["heldout_names_recall_gain"] = {
                    "value": round(heldout["model"]["recall"] - heldout["baseline"]["recall"], 4),
                    "min": g["heldout_names_recall_gain"]}
    for v in gates.values():
        v["passed"] = v["value"] is not None and (v["value"] <= v["max"] if "max" in v else v["value"] >= v["min"])
    section = {"model": "pytorch-fp32", "splits": results, "gates": gates}
    if genre:
        section["synth_genre"] = genre
    if heldout:
        section["heldout_names"] = heldout
    update_eval(cfg, "metrics", section)
    for name, r in results.items():
        print(f"{name:17s} PER {r['PER']['f1-score']:.4f}  ORG {r['ORG']['f1-score']:.4f} "
              f"(P {r['ORG']['precision']:.4f})  LOC {r['LOC']['f1-score']:.4f}  micro {r['micro_f1']:.4f}")
    if genre:
        print(f"synth_genre: false ORG on {genre['negative_sentences']} negative sentences: "
              f"{genre['false_org_on_negatives']} (any type: {genre['false_spans_on_negatives']}); "
              f"extension decoding {genre['ext_thresholds']}: {genre['ext_false_spans_on_negatives']}")
        for gname, r in genre["by_genre"].items():
            print(f"  {gname:10s} n={r['sentences']:4d}  PER P/R {r.get('PER', {}).get('precision', 0):.3f}/"
                  f"{r.get('PER', {}).get('recall', 0):.3f}  ORG P/R {r.get('ORG', {}).get('precision', 0):.3f}/"
                  f"{r.get('ORG', {}).get('recall', 0):.3f}  false ORG on negatives {r['false_org_on_negatives']}")
    if heldout:
        for key in ("model", "baseline"):
            if key in heldout:
                h = heldout[key]
                print(f"heldout_names {key}: recall {h['recall']:.4f} ({h['found']}/{h['total']}) "
                      + " ".join(f"{gname} {x['found']}/{x['total']}" for gname, x in h["by_group"].items()))
        print("heldout_names missed:", "; ".join(heldout["model"]["missed"]))
    failed = []
    for k, v in gates.items():
        val = "n/a" if v["value"] is None else f"{v['value']:.4f}"
        cond = f"<= {v['max']}" if "max" in v else f">= {v['min']}"
        print(f"gate {k}: {val} {cond} -> {'PASS' if v['passed'] else 'FAIL'}"
              + (" (informational)" if v.get("informational") else ""))
        if not v["passed"] and not v.get("informational"):
            failed.append(k)
    print(json.dumps({"eval.json": str(rd / "eval.json"), "failed_gates": failed}))
    if args.strict and failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
