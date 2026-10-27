"""Check the int8 ONNX model against the PyTorch fp32 model.

1. Argmax agreement on non-padding tokens and mean |logit difference|, inputs padded to [*,128]:
   verify.sentences (50, half ru / half en; informational since 1.2.0) and then verify.gate_sentences (2 000:
   1 000 ru + 1 000 en test sentences) — the gate (>= verify.min_agreement, 99 %) is on the larger sample since 1.2.0
   (50 sentences = 670 tokens: one token is 0.15 pp).
2. A [8,128] batch runs on CPUExecutionProvider without errors.
3. Word-level seqeval F1 of the int8 model on the full ru/en test sets (the model that is actually shipped).
4. (1.2.0) The shipped int8 on the extension-decoding checks of evaluate.py: false spans on the entity-free sentences
   of test_synth_genre (argmax and extension decoding) and PER recall on evaluate.heldout_names (K10) against the
   int8 of the baseline pack (verify.baseline_onnx, the published 1.1.0 model.onnx) when it exists.
"""
from __future__ import annotations

import random

import numpy as np
from common import (ROOT, bio_spans, load_config, ort_logits, ort_session, run_dir, torch_logits,  # noqa: E402
                    update_eval, word_level)
from datasets import concatenate_datasets, load_from_disk
from seqeval.metrics import classification_report
from transformers import AutoModelForTokenClassification


def agreement(sess, model, sample, max_len):
    pt = torch_logits(model, sample)
    ox = ort_logits(sess, sample, batch_size=8, pad_to=max_len)
    same = total = 0
    diffs = []
    for a, b in zip(pt, ox):
        same += int((a.argmax(-1) == b.argmax(-1)).sum())
        total += a.shape[0]
        diffs.append(np.abs(a - b).reshape(-1))
    d = np.concatenate(diffs)
    return same / total, float(d.mean()), float(d.max()), total


def int8_f1(sess, split, labels):
    logits = ort_logits(sess, split, batch_size=128)
    y_true, y_pred = [], []
    for lg, wid, tags in zip(logits, split["word_ids"], split["ner_tags"]):
        y_pred.append(word_level(lg, wid, len(tags), labels)[0])
        y_true.append([labels[t] for t in tags])
    rep = classification_report(y_true, y_pred, output_dict=True)
    return {k: round(float(rep[k]["f1-score"]), 4) for k in ("PER", "ORG", "LOC", "micro avg")}


def int8_extension_checks(cfg, rd, data, sess, labels):
    """Item 4 of the docstring: the shipped int8 on evaluate.py's extension-decoding checks."""
    from evaluate import ext_false_spans, heldout_cases, heldout_recall
    out = {}
    if "test_synth_genre" in data:
        split = data["test_synth_genre"]
        lg = ort_logits(sess, split, batch_size=128)
        argmax = {"PER": 0, "ORG": 0, "LOC": 0}
        for neg, x, wid, tags in zip(split["negative"], lg, split["word_ids"], split["ner_tags"]):
            if neg:
                for t, *_ in bio_spans(word_level(x, wid, len(tags), labels)[0]):
                    argmax[t] += 1
        th = {"PER": 0.7, "ORG": 0.85, "LOC": 0.7, **cfg.get("evaluate", {}).get("ext_thresholds", {})}
        out["int8_synth_genre"] = {"negative_sentences": int(sum(split["negative"])), "false_spans_argmax": argmax,
                                   "ext_thresholds": th, "false_spans_extension": ext_false_spans(split, lg, th)}
    ev = cfg.get("evaluate", {})
    if ev.get("heldout_names"):
        cases = heldout_cases(ev["heldout_names"])
        th = float(ev.get("threshold", 0.7))
        h = {"threshold": th, "model": heldout_recall(rd / "model", cases, labels, th,
                                                      onnx=rd / "onnx" / "model.int8.onnx")}
        base = cfg.get("verify", {}).get("baseline_onnx")
        if base and (ROOT / base).exists():
            h["baseline"] = {"path": base, **heldout_recall(rd / "model", cases, labels, th, onnx=ROOT / base)}
            h["recall_gain"] = round(h["model"]["recall"] - h["baseline"]["recall"], 4)
        out["int8_heldout_names"] = h
    return out


def main():
    cfg, _ = load_config()
    rd = run_dir(cfg)
    labels = cfg["labels"]
    max_len = cfg["data"]["max_length"]
    n = int(cfg["verify"]["sentences"])
    n_gate = int(cfg["verify"].get("gate_sentences", 2000))
    data = load_from_disk(str(rd / "data"))
    rng = random.Random(cfg["seed"])
    parts = []
    for name, k in (("test_ru", n - n // 2), ("test_en", n // 2)):
        idx = sorted(rng.sample(range(len(data[name])), k))
        parts.append(data[name].select(idx))
    sample = concatenate_datasets(parts)

    model = AutoModelForTokenClassification.from_pretrained(str(rd / "model")).eval()  # CPU fp32 reference
    int8 = ort_session(rd / "onnx" / "model.int8.onnx")
    fp32 = ort_session(rd / "onnx" / "model.fp32.onnx")
    assert int8.get_providers() == ["CPUExecutionProvider"], int8.get_providers()

    agr8, mean8, max8, tokens = agreement(int8, model, sample, max_len)
    agr32, mean32, max32, _ = agreement(fp32, model, sample, max_len)
    # the gate: the same check on a larger sample (1000 ru + 1000 en test sentences; drawn after the 50 above, so the
    # sample is the one reported for 1.1.0 and the first 1.2.0 build)
    big = concatenate_datasets([data[name].select(sorted(rng.sample(range(len(data[name])), k)))
                                for name, k in (("test_ru", n_gate - n_gate // 2), ("test_en", n_gate // 2))])
    agr_big, mean_big, _, tokens_big = agreement(int8, model, big, max_len)

    # [8,128] batch smoke test
    ids = np.random.default_rng(cfg["seed"]).integers(5, 83828, size=(8, max_len), dtype=np.int64)
    mask = np.ones_like(ids)
    mask[4:, max_len // 2:] = 0
    out = int8.run(["logits"], {"input_ids": ids, "attention_mask": mask, "token_type_ids": np.zeros_like(ids)})[0]
    assert out.shape == (8, max_len, len(labels)) and np.isfinite(out).all()

    f1 = {name: int8_f1(int8, data[name], labels) for name in ("test_ru", "test_en")}
    extra = int8_extension_checks(cfg, rd, data, int8, labels)
    min_agr = float(cfg["verify"]["min_agreement"])
    info = {"sentences": len(sample), "tokens": tokens, "padded_to": max_len,
            "int8_vs_torch": {"argmax_agreement": round(agr8, 5), "mean_abs_logit_diff": round(mean8, 5),
                              "max_abs_logit_diff": round(max8, 4), "informational": True},
            "int8_vs_torch_2000_sentences": {"sentences": len(big), "tokens": tokens_big,
                                             "argmax_agreement": round(agr_big, 5),
                                             "mean_abs_logit_diff": round(mean_big, 5)},
            "fp32_onnx_vs_torch": {"argmax_agreement": round(agr32, 5), "mean_abs_logit_diff": mean32},
            "batch_8x128": {"provider": int8.get_providers()[0], "output_shape": list(out.shape), "ok": True},
            "int8_test_f1": f1, **extra,
            "gate": {"on": f"{len(big)} sentences", "min_agreement": min_agr, "value": round(agr_big, 5),
                     "passed": agr_big >= min_agr}}
    update_eval(cfg, "verify", info)
    print(f"{len(sample)} sentences, {tokens} non-padding tokens")
    print(f"int8 vs torch fp32: argmax agreement {agr8:.4%}, mean |dlogit| {mean8:.4f}, max {max8:.3f}")
    print(f"int8 vs torch fp32 on {len(big)} sentences ({tokens_big} tokens): agreement {agr_big:.4%}, "
          f"mean |dlogit| {mean_big:.4f}")
    print(f"fp32 onnx vs torch: argmax agreement {agr32:.4%}, mean |dlogit| {mean32:.2e}")
    print(f"[8,{max_len}] batch on {int8.get_providers()[0]}: OK {out.shape}")
    for k, v in f1.items():
        print(f"int8 {k}: {v}")
    if "int8_synth_genre" in extra:
        print(f"int8 synth_genre negatives: {extra['int8_synth_genre']}")
    for k, h in extra.get("int8_heldout_names", {}).items():
        if isinstance(h, dict) and "recall" in h:
            print(f"int8 heldout_names {k}: recall {h['recall']:.4f} ({h['found']}/{h['total']}) "
                  + " ".join(f"{g} {x['found']}/{x['total']}" for g, x in h["by_group"].items()))
    print(f"gate agreement on {len(big)} sentences >= {min_agr:.0%}: {'PASS' if agr_big >= min_agr else 'FAIL'}")
    if agr_big < min_agr:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
