"""Build the training mix from config.yaml data.sources[] + synthetic sentences, tokenize with the base WordPiece
tokenizer and align labels.

Labels are put on the first sub-token of every word; other sub-tokens and special tokens get -100.
Splits in runs/<run_id>/data/ (datasets.DatasetDict saved to disk):
  train                      — weighted mix of the sources' train splits + synthetic sentences (shuffled);
  validation                 — validation splits of the sources that have one (WikiANN ru+en), model selection;
  validation_<lang>, test_<lang> — WikiANN per language (gates ru_per_f1 / ru_org_f1);
  test_<source id>           — held-out part of other corpora (e.g. test_factru, test_nerel, informational);
  validation_<kind>          — validation split of other corpora (e.g. validation_nerel: ablations, not model selection);
  test_synth_genre           — held-out genre sentences (gate synth_genre_org_precision; columns genre, negative).

Test-overlap check (1.2.0): train sentences of sources with `dedupe: true` (NEREL, Nerus) are compared with the test
sets (WikiANN test, test_factru, the genre corpus, the held-out fixtures) by a normalized key (lowercase, ё -> е,
letters and digits only); matching sentences, and whole documents with >= 2 matches, are removed from train
(data_info.json -> test_overlap).
"""
from __future__ import annotations

import glob
import hashlib
import json
import random
import re
import zipfile

from common import REPO, bio_spans, load_config, run_dir, set_seed  # noqa: E402  (sets HF_HOME)
from datasets import ClassLabel, Dataset, DatasetDict, Features, Sequence, Value, concatenate_datasets
from pathlib import Path

from transformers import AutoTokenizer


def tokenize_and_align(batch, tokenizer, max_length):
    enc = tokenizer(batch["tokens"], is_split_into_words=True, truncation=True, max_length=max_length)
    all_labels, all_word_ids = [], []
    ignore = batch["ignore"] if "ignore" in batch else None
    for i, tags in enumerate(batch["ner_tags"]):
        word_ids = enc.word_ids(batch_index=i)
        labels, prev = [], None
        for w in word_ids:
            if w is None or w == prev or (ignore is not None and ignore[i][w]):
                labels.append(-100)
            else:
                labels.append(tags[w])
            prev = w
        all_labels.append(labels)
        all_word_ids.append([-1 if w is None else w for w in word_ids])
    enc["labels"] = all_labels
    enc["word_ids"] = all_word_ids
    return enc


def features(labels, ignore=False):
    f = {"tokens": Sequence(Value("string")), "ner_tags": Sequence(ClassLabel(names=labels)), "lang": Value("string")}
    if ignore:  # train split: per word 1 = no hard label (sources with ignore_types)
        f["ignore"] = Sequence(Value("int8"))
    return Features(f)


def apply_ignore(rows: dict, src: dict, labels: list) -> dict:
    """ignore column of a train split: words whose type is in src.ignore_types (and the loader's own marks, e.g. NEREL
    dropped descriptive organisations) get no hard label; without ignore_types — zeros."""
    types = set(src.get("ignore_types") or [])
    own = rows.get("ignore")
    out = []
    for i, tags in enumerate(rows["ner_tags"]):
        if not types:
            out.append([0] * len(tags))
            continue
        out.append([1 if (labels[t] != "O" and labels[t][2:] in types) or (own and own[i][j]) else 0
                    for j, t in enumerate(tags)])
    return {**rows, "ignore": out}


def weighted(rows: dict, weight: float, rng: random.Random) -> dict:
    """Repeat a split int(weight) times and add a random subsample for the fractional part."""
    n = len(rows["tokens"])
    idx = list(range(n)) * int(weight)
    frac = weight - int(weight)
    if frac > 0:
        idx += sorted(rng.sample(range(n), round(n * frac)))
    return {k: [v[i] for i in idx] for k, v in rows.items()}


def fingerprint(ds) -> str:
    h = hashlib.sha256()
    for toks, tags in zip(ds["tokens"], ds["ner_tags"]):
        h.update(("\x1f".join(toks) + "\x1e" + ",".join(map(str, tags)) + "\x1d").encode())
    return h.hexdigest()


def gold_files(patterns) -> list[str]:
    patterns = [patterns] if isinstance(patterns, str) else list(patterns)
    return sorted({f for p in patterns for f in glob.glob(str(REPO / p), recursive=True)})


def gold_values(patterns) -> tuple[dict, list[str]]:
    """PERSON / COMPANY values of the evaluation gold files (genre corpus WP11-B / WP12-C, held-out fixtures, the K11
    backlog cases), to keep them out of the synthetic data. A file has `entities` and / or `cases[].entities`."""
    files = gold_files(patterns)
    vals = {"PERSON": set(), "COMPANY": set()}
    for f in files:
        data = json.loads(Path(f).read_text(encoding="utf-8"))
        ents = list(data.get("entities", [])) + [e for c in data.get("cases", []) for e in c.get("entities", [])]
        for e in ents:
            if e.get("category") in vals:
                vals[e["category"]].add(e["value"])
    return vals, files


# ---- test-overlap check (1.2.0) -----------------------------------------------------------------------------------

def norm_key(text: str) -> str:
    """Tokenization-independent sentence key: lowercase, ё -> е, letters and digits only."""
    return re.sub(r"[^0-9a-zа-я]", "", text.lower().replace("ё", "е"))


MIN_KEY = 12  # shorter keys ("Москва", "Итого") are too generic to count as an overlap


def _xml_text(data: bytes) -> str:
    txt = data.decode("utf-8", "replace")
    txt = re.sub(r"</(?:w:p|a:p|si|row|c)>", "\n", txt)
    txt = re.sub(r"<w:tab/>|<a:tab/>", " ", txt)
    txt = re.sub(r"<[^>]+>", "", txt)
    return txt.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'").replace("&amp;", "&")


def fixture_texts(patterns) -> list[str]:
    """Plain text of evaluation documents (DOCX / XLSX / PPTX parts, PDF text snapshots, CSV / JSON / TXT) and the
    texts of the K11 backlog cases."""
    out = []
    for f in gold_files(patterns):
        base = f[:-len(".gold.json")] if f.endswith(".gold.json") else None
        if base is None:
            data = json.loads(Path(f).read_text(encoding="utf-8"))
            out += [c["text"] for c in data.get("cases", []) if c.get("text")]
            continue
        for ext in (".docx", ".xlsx", ".pptx"):
            if Path(base + ext).exists():
                with zipfile.ZipFile(base + ext) as z:
                    for n in z.namelist():
                        if n.endswith(".xml") and not n.startswith(("[", "docProps/app", "customXml")):
                            out.append(_xml_text(z.read(n)))
        for ext in (".pdf.txt", ".csv", ".json", ".txt", ".md", ".log"):
            if Path(base + ext).exists():
                raw = Path(base + ext).read_bytes()
                try:
                    out.append(raw.decode("utf-8"))
                except UnicodeDecodeError:
                    out.append(raw.decode("cp1251", "replace"))
    return out


def text_keys(texts) -> set:
    """Keys of every line and every sentence of the texts."""
    keys = set()
    for t in texts:
        for line in t.splitlines():
            parts = [line] + re.split(r"(?<=[.!?…])\s+", line)
            for p in parts:
                k = norm_key(p)
                if len(k) >= MIN_KEY:
                    keys.add(k)
    return keys


def split_keys(ds) -> set:
    return {k for k in (norm_key(" ".join(t)) for t in ds["tokens"]) if len(k) >= MIN_KEY}


def drop_overlap(rows: dict, test_keys: set, min_doc_hits: int = 2) -> tuple[dict, dict]:
    """Remove train rows whose key is a test key, and whole documents with >= min_doc_hits such rows."""
    keys = [norm_key(" ".join(t)) for t in rows["tokens"]]
    hit = [len(k) >= MIN_KEY and k in test_keys for k in keys]
    docs = rows.get("doc") or [None] * len(keys)
    per_doc = {}
    for d, h in zip(docs, hit):
        if d is not None and h:
            per_doc[d] = per_doc.get(d, 0) + 1
    bad_docs = {d for d, n in per_doc.items() if n >= min_doc_hits}
    keep = [i for i, (d, h) in enumerate(zip(docs, hit)) if not h and d not in bad_docs]
    info = {"sentences": len(keys), "matched_sentences": sum(hit), "docs_with_matches": len(per_doc),
            "docs_removed": len(bad_docs), "removed_sentences": len(keys) - len(keep),
            "examples": [" ".join(rows["tokens"][i])[:120] for i, h in enumerate(hit) if h][:10]}
    return {k: [v[i] for i in keep] for k, v in rows.items()}, info


def entity_strings(ds, labels) -> dict:
    out = {"PER": set(), "ORG": set(), "LOC": set()}
    for toks, tags in zip(ds["tokens"], ds["ner_tags"]):
        for typ, a, b in bio_spans([labels[t] for t in tags]):
            out[typ].add(" ".join(toks[a:b]))
    return out


def gold_overlap(gold: dict, ds, labels) -> dict:
    """Exact matches of gold values (tokenized like synth.py) with entity spans of a split."""
    from synth import TOKEN_RE, _norm
    ents = {k: {_norm(x) for x in v} for k, v in entity_strings(ds, labels).items()}
    res = {}
    for cat, typ in (("PERSON", "PER"), ("COMPANY", "ORG")):
        hits = sorted(v for v in gold[cat] if _norm(" ".join(TOKEN_RE.findall(v))) in ents[typ])
        res[cat] = {"gold_values": len(gold[cat]), "exact_matches": len(hits), "values": hits}
    return res


def synth_count(n_real: int, sc: dict, mode: str) -> tuple[int, float]:
    if "share" in sc:
        share = float(sc["share"])
        if mode == "teacher_synth":
            share = max(share, float(sc.get("teacher_synth_min_share", 0.5)))
        assert 0 <= share <= float(sc.get("max_ratio", 0.5)), f"synthetic share {share} > synth.max_ratio"
        assert share < 1
        return round(n_real * share / (1 - share)), share
    n = int(n_real * float(sc["ratio"]))  # legacy 1.0.0 key: relative to the real train size
    share = n / (n + n_real)
    assert share <= float(sc.get("max_ratio", 0.5)), f"synthetic share {share:.3f} > synth.max_ratio"
    return n, share


def main():
    cfg, _ = load_config()
    set_seed(cfg["seed"])
    rng = random.Random(cfg["seed"])
    labels = cfg["labels"]
    feats = features(labels)
    out = run_dir(cfg) / "data"
    tokenizer = AutoTokenizer.from_pretrained(cfg["base_model"])
    dc = cfg["data"]
    max_length = dc["max_length"]
    mode = dc.get("mode", "sources")
    assert mode in ("sources", "teacher_synth"), mode

    from sources import load_source
    train_parts, val_parts, result, src_info = [], [], {}, []
    strip = lambda rows: {k: v for k, v in rows.items() if k not in ("doc", "ignore")}  # noqa: E731
    feats_train = features(labels, ignore=True)
    loaded = []
    for src in dc["sources"]:
        if mode == "teacher_synth" and src["kind"] != "wikiann":
            src_info.append({"id": src["id"], "skipped": "data.mode=teacher_synth"})
            continue
        if float(src.get("weight", 1)) <= 0:
            src_info.append({"id": src["id"], "skipped": "weight 0"})
            continue
        d = load_source(src, labels)
        loaded.append((src, d))
        if src["kind"] == "wikiann":
            lang = src["lang"]
            v = Dataset.from_dict(strip(d["validation"]), features=feats)
            val_parts.append(v)
            result[f"validation_{lang}"] = v
            result[f"test_{lang}"] = Dataset.from_dict(strip(d["test"]), features=feats)
        else:
            if d.get("test"):
                result[f"test_{src['kind']}"] = Dataset.from_dict(strip(d["test"]), features=feats)
            if d.get("validation"):
                result[f"validation_{src['kind']}"] = Dataset.from_dict(strip(d["validation"]), features=feats)

    # test-overlap check: sources marked dedupe (NEREL, Nerus) against every test set and the evaluation fixtures
    overlap = None
    if any(src.get("dedupe") for src, _ in loaded):
        texts = fixture_texts(dc.get("overlap_fixtures", []))
        test_sets = {n: split_keys(ds) for n, ds in result.items() if n.startswith("test_")}
        fixture_keys = text_keys(texts)
        test_keys = set().union(*test_sets.values()) | fixture_keys
        overlap = {"test_sets": {n: len(k) for n, k in test_sets.items()}, "fixture_texts": len(texts),
                   "fixture_keys": len(fixture_keys), "min_key_chars": MIN_KEY, "sources": {}}
    for src, d in loaded:
        rows = d["train"]
        info = {"id": src["id"], "kind": src["kind"], "weight": src.get("weight", 1)}
        if overlap is not None and src.get("dedupe"):
            rows, ov = drop_overlap(rows, test_keys)
            # per test set, for the report
            all_keys = [norm_key(" ".join(t)) for t in d["train"]["tokens"]]
            ov["by_test_set"] = {n: sum(1 for x in all_keys if x in k) for n, k in test_sets.items()}
            ov["by_fixtures"] = sum(1 for x in all_keys if x in fixture_keys)
            overlap["sources"][src["id"]] = ov
        rows = apply_ignore(rows, src, labels)
        if src.get("ignore_types"):
            info["ignored_words"] = sum(map(sum, rows["ignore"]))
        rows = {k: v for k, v in rows.items() if k != "doc"}
        tr = weighted(rows, float(src.get("weight", 1)), rng)
        train_parts.append(Dataset.from_dict(tr, features=feats_train))
        info.update({"train_sentences": len(rows["tokens"]), "train_used": len(tr["tokens"])})
        if d.get("stats"):
            info["stats"] = d["stats"]
        if src["kind"] != "wikiann":
            for split in ("test", "validation"):
                if d.get(split):
                    info[f"{split}_split"] = f"{split}_{src['kind']}"
                    info[f"{split}_sentences"] = len(d[split]["tokens"])
        src_info.append(info)

    real = concatenate_datasets(train_parts)
    synth_info = None
    parts = [real]
    sc = dc["synth"]
    if sc["enabled"]:
        from synth import Lex, generate, generate_genre_test, gold_block_words
        n, share = synth_count(len(real), sc, mode)
        gold, gfiles, block = None, [], None
        if sc.get("exclude_gold"):
            gold, gfiles = gold_values(sc["exclude_gold"])
            block = gold_block_words(gold["PERSON"] | gold["COMPANY"])
        sd = generate(n, int(sc["seed"]), labels, genre_share=float(sc.get("genre_share", 0.0)),
                      negative_share=float(sc.get("negative_share", 0.45)), block=block)
        neg = sum(sd["negative"]) / max(1, len(sd))
        assert neg >= float(sc.get("min_negative_share", 0.0)), f"entity-free synthetic share {neg:.3f} too low"
        genres = {}
        for g in sd["genre"]:
            genres[g] = genres.get(g, 0) + 1
        exclude = {tuple(t) for t in sd["tokens"]}
        gt = generate_genre_test(int(sc.get("test_size", 2000)), int(sc["test_seed"]), labels,
                                 float(sc.get("negative_share", 0.45)), exclude, block=block)
        result["test_synth_genre"] = gt.cast_column("ner_tags", Sequence(ClassLabel(names=labels)))
        sd_train = sd.remove_columns(["genre", "negative"])
        sd_train = sd_train.add_column("ignore", [[0] * len(t) for t in sd_train["tokens"]])
        parts.append(sd_train.cast(feats_train))
        synth_info = {"sentences": n, "share": round(share, 4), "negative_share": round(neg, 4), "genres": genres,
                      "test_synth_genre": {"sentences": len(gt), "negative": int(sum(gt["negative"]))}}
        if gold is not None:
            removed = {k: v for part in ("train", "test") for k, v in Lex(part, block).removed.items()}
            synth_info["gold_exclusion"] = {
                "pattern": sc["exclude_gold"], "files": len(gfiles),
                "gold_hash": hashlib.sha256("".join(Path(f).read_text(encoding="utf-8") for f in gfiles)
                                            .encode()).hexdigest()[:16],
                "block_words": len(block), "removed_items": sum(len(v) for v in removed.values()),
                "removed": removed,
                "synth_train": gold_overlap(gold, sd, labels), "synth_genre_test": gold_overlap(gold, gt, labels),
                "real_train": gold_overlap(gold, real, labels)}
    train = concatenate_datasets(parts)
    result["train"] = train.shuffle(seed=cfg["seed"])
    result["validation"] = concatenate_datasets(val_parts)

    dd = DatasetDict(result)
    dd = dd.map(tokenize_and_align, batched=True, fn_kwargs={"tokenizer": tokenizer, "max_length": max_length},
                desc="tokenize")
    dd.save_to_disk(str(out))
    truncated = {k: sum(1 for wi, t in zip(v["word_ids"], v["tokens"]) if max(wi) + 1 < len(t)) for k, v in dd.items()}
    info = {"sizes": {k: len(v) for k, v in dd.items()}, "truncated_sentences": truncated, "mode": mode,
            "sources": src_info, "real_train": len(real), "synth": synth_info, "max_length": max_length,
            "test_overlap": overlap,
            "train_fingerprint": fingerprint(dd["train"])}
    (run_dir(cfg) / "data_info.json").write_text(json.dumps(info, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(info, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
