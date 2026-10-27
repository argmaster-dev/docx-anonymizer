"""Evaluation-only comparison of our NER model with Natasha (Slovnet NER). Natasha is used neither for training nor in
the extension package; it lives in the optional dependency group "compare":

    uv run --group compare python compare_natasha.py [--run-id rubert-tiny2-ner-ruen-1.1.0] [--skip-torch]

Models
  ours-int8   — models-src/<id>/model.onnx (the shipped int8 ONNX; version checked against pack.src.json),
                onnxruntime CPU, decoded as in the extension (src/core/ner/bio.js decodeWord + mergeBio):
                per word the softmax vector at its first sub-token; type = argmax of the type marginals
                {O, PER=B-PER+I-PER, ORG, LOC}; tag B if P(B-X) >= P(X)/2 else I; lenient BIO merge (I-X after O or
                another type starts a new span); span score = mean marginal probability of the span type over its
                words; spans with score < threshold are dropped. Thresholds: 0.7 for every type (nerThreshold, main
                number), none (0.0), and the extension defaults PER/LOC 0.7 + ORG 0.85 (nerThresholdOrg).
                The extension's JS post-processing (bridgePunct, joinAdjacent, filterSpans, alignSpans, filters.js)
                is NOT reproduced: this compares model + decoding + threshold.
  ours-fp32   — runs/<run_id>/model (PyTorch fp32, CPU), same decoding (reference).
  natasha     — the stock pipeline: Segmenter, NewsEmbedding, NewsNERTagger, Doc.segment + Doc.tag_ner, no tuning.

Sentence sets (runs/<run_id>/data, Russian only): test_ru (WikiANN), test_factru (informational: possible test
leakage in favour of Natasha), test_synth_genre restricted to lang == ru (plus the full 2000 for ours as a cross-check).
Tokens are joined with single spaces for Natasha; Natasha's character spans are projected onto the dataset words
(a word gets the span type when it overlaps the span; the first overlapping word gets B). Projection error is
reported (spans whose start/end fall inside a word). Metric: seqeval (default mode), exact span match, PER/ORG/LOC.

Genre corpus (tests/fixtures/genres/**, Russian documents): text from DOCX (word/document.xml + headers, footers,
footnotes; paragraphs joined with "\\n"), from the PDF text snapshot <name>.pdf.txt and (1.2.0) from the office formats
of version 0.5 ("office": XLSX cells, PPTX slide and notes paragraphs, CSV / JSON as is).
--pipeline-json adds the whole extension pipeline (rules + dictionaries + model, tools/ner-train/pipeline_values.mjs:
analyze() in the commercial mode) as one more row of the document-level table, scored by the found values.
Gold has values only, so the metric is document level: per document the sets of normalized PERSON / COMPANY values vs the normalized values of the
predicted PER / ORG spans (exact value match), plus a lenient overlap variant using gold occurrences found in the text.

Speed and cold start are measured in fresh subprocesses with one CPU thread (OMP/MKL/OpenBLAS = 1, ORT intra-op = 1).
Output: runs/compare-natasha/compare.json (outside git) and a Markdown summary on stdout.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import statistics
import subprocess
import sys
import time
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
os.environ.setdefault("HF_HOME", str(ROOT / ".cache" / "hf"))

LABELS = ["O", "B-PER", "I-PER", "B-ORG", "I-ORG", "B-LOC", "I-LOC"]
TYPES = ("PER", "ORG", "LOC")
THRESHOLDS = {"t0.7": {"PER": 0.7, "ORG": 0.7, "LOC": 0.7},
              "none": {"PER": 0.0, "ORG": 0.0, "LOC": 0.0},
              "ext_defaults": {"PER": 0.7, "ORG": 0.85, "LOC": 0.7}}
MAX_LEN = 128
BATCH = 8


# ----------------------------------------------------------------------------------------------- decoding (ours)

def softmax(x):
    import numpy as np
    e = np.exp(x - x.max(axis=-1, keepdims=True))
    return e / e.sum(axis=-1, keepdims=True)


def decode_word(p):
    """src/core/ner/bio.js decodeWord: (tag, type, prob) from the softmax vector of the first sub-token."""
    m = {"O": float(p[0]), "PER": float(p[1] + p[2]), "ORG": float(p[3] + p[4]), "LOC": float(p[5] + p[6])}
    b = {"PER": float(p[1]), "ORG": float(p[3]), "LOC": float(p[5])}
    best = "O"
    for k in TYPES:
        if m[k] > m[best]:
            best = k
    if best == "O":
        return "O", None, m["O"]
    return ("B" if b[best] * 2 >= m[best] else "I"), best, m[best]


def merge_bio(words):
    """words: list of (tag, type, prob) -> spans (type, start_word, end_word_excl, score); bio.js mergeBio."""
    spans, cur = [], None
    for i, (tag, typ, prob) in enumerate(words):
        if tag == "O":
            if cur:
                spans.append(cur); cur = None
            continue
        if tag == "B" or cur is None or cur[0] != typ:
            if cur:
                spans.append(cur)
            cur = [typ, i, i + 1, prob, 1]
        else:
            cur[2] = i + 1; cur[3] += prob; cur[4] += 1
    if cur:
        spans.append(cur)
    return [(t, a, b, s / n) for t, a, b, s, n in spans]


def words_from_logits(logits_row, word_ids_row, n_words):
    """Decoded word predictions; words without a first sub-token (truncated) are O."""
    probs = softmax(logits_row)
    out = [("O", None, 1.0)] * n_words
    prev = None
    for pos, w in enumerate(word_ids_row):
        if w is not None and w >= 0 and w != prev:
            out[w] = decode_word(probs[pos])
        prev = w
    return out


def apply_threshold(spans, th):
    return [s for s in spans if s[3] >= th[s[0]]]


def spans_to_tags(n, spans):
    tags = ["O"] * n
    for t, a, b, *_ in spans:
        for i in range(a, b):
            tags[i] = ("B-" if i == a else "I-") + t
    return tags


# ----------------------------------------------------------------------------------------------- metrics

def seq_report(y_true, y_pred):
    from seqeval.metrics import classification_report
    rep = classification_report(y_true, y_pred, output_dict=True, zero_division=0)
    out = {}
    for k in (*TYPES, "micro avg"):
        if k in rep:
            out[k] = {m: round(float(rep[k][m]), 4) for m in ("precision", "recall", "f1-score")}
            out[k]["support"] = int(rep[k]["support"])
    return out


def bio_spans(tags):
    spans, cur = [], None
    for i, t in enumerate(tags):
        if t == "O":
            if cur:
                spans.append(tuple(cur)); cur = None
            continue
        p, typ = t.split("-", 1)
        if p == "B" or cur is None or cur[0] != typ:
            if cur:
                spans.append(tuple(cur))
            cur = [typ, i, i + 1]
        else:
            cur[2] = i + 1
    if cur:
        spans.append(tuple(cur))
    return spans


def overlap_report(y_true, y_pred):
    """Lenient span match: a predicted span is correct when it overlaps a not yet matched gold span of the same type
    (greedy one-to-one). Shows how much of the gap is boundary convention rather than missed entities."""
    out = {}
    for typ in (*TYPES, None):
        tp = fp = fn = 0
        for yt, yp in zip(y_true, y_pred):
            g = [s for s in bio_spans(yt) if typ is None or s[0] == typ]
            p = [s for s in bio_spans(yp) if typ is None or s[0] == typ]
            used = set()
            for ps in p:
                hit = next((k for k, gs in enumerate(g) if k not in used and gs[0] == ps[0]
                            and gs[1] < ps[2] and ps[1] < gs[2]), None)
                if hit is None:
                    fp += 1
                else:
                    used.add(hit); tp += 1
            fn += len(g) - len(used)
        pr = tp / (tp + fp) if tp + fp else 0.0
        rc = tp / (tp + fn) if tp + fn else 0.0
        out[typ or "micro"] = round(2 * pr * rc / (pr + rc), 4) if pr + rc else 0.0
    return out


def negatives_report(y_pred, negative_flags):
    neg = [p for p, f in zip(y_pred, negative_flags) if f]
    spans = [s for p in neg for s in bio_spans(p)]
    return {"negative_sentences": len(neg),
            "false_PER": sum(1 for s in spans if s[0] == "PER"),
            "false_ORG": sum(1 for s in spans if s[0] == "ORG"),
            "false_LOC": sum(1 for s in spans if s[0] == "LOC"),
            "sentences_with_any_false_span": sum(1 for p in neg if bio_spans(p))}


# ----------------------------------------------------------------------------------------------- Natasha

class Natasha:
    def __init__(self):
        from natasha import Doc, NewsEmbedding, NewsNERTagger, Segmenter
        self.Doc = Doc
        self.segmenter = Segmenter()
        self.tagger = NewsNERTagger(NewsEmbedding())

    def spans(self, text):
        doc = self.Doc(text)
        doc.segment(self.segmenter)
        doc.tag_ner(self.tagger)
        return [(s.type, s.start, s.stop) for s in doc.spans]

    def spans_lines(self, text):
        """Each line (paragraph) separately, as the extension feeds our model."""
        out, pos = [], 0
        for line in text.split("\n"):
            if line.strip():
                out += [(t, pos + a, pos + b) for t, a, b in self.spans(line)]
            pos += len(line) + 1
        return out


def natasha_types(spans):
    unknown = {t for t, *_ in spans if t not in TYPES}
    assert not unknown, unknown


def project_to_words(tokens, spans, stats):
    """Natasha char spans on ' '.join(tokens) -> word BIO tags; counts projection mismatches."""
    starts, ends, pos = [], [], 0
    for t in tokens:
        starts.append(pos); ends.append(pos + len(t)); pos += len(t) + 1
    tags = ["O"] * len(tokens)
    owner = [None] * len(tokens)
    for k, (typ, a, b) in enumerate(sorted(spans, key=lambda s: s[1])):
        stats["spans"] += 1
        idx = [i for i in range(len(tokens)) if starts[i] < b and ends[i] > a]
        if not idx:
            stats["no_word"] += 1
            continue
        exact = starts[idx[0]] == a and ends[idx[-1]] == b
        if not exact:
            stats["misaligned"] += 1
            if starts[idx[0]] != a:
                stats["start_inside_word"] += 1
            if ends[idx[-1]] != b:
                stats["end_inside_word"] += 1
        for j, i in enumerate(idx):
            if owner[i] is not None and owner[i] != k:
                stats["word_conflicts"] += 1
            owner[i] = k
            tags[i] = ("B-" if j == 0 else "I-") + typ
    return tags


# ----------------------------------------------------------------------------------------------- ours on raw text

class OursText:
    """Our ONNX model on raw document text: lines -> sentences (as windows.js sentenceRanges, simplified) ->
    windows of <= MAX_LEN-2 sub-tokens cut on word boundaries (no stride overlap) -> batches of 8 -> char spans."""

    def __init__(self, onnx_path, vocab_path, threads=0):
        from tokenizers import BertWordPieceTokenizer
        sys.path.insert(0, str(ROOT))
        from common import ort_session
        self.sess = ort_session(onnx_path, threads=threads)
        self.tok = BertWordPieceTokenizer(str(vocab_path), lowercase=False, strip_accents=False, clean_text=True,
                                          handle_chinese_chars=True)
        self.cls, self.sep = self.tok.token_to_id("[CLS]"), self.tok.token_to_id("[SEP]")

    def words(self, line):
        enc = self.tok.encode(line, add_special_tokens=False)
        words = []  # [start, end, [ids]]
        prev = None
        for tid, wid, (a, b) in zip(enc.ids, enc.word_ids, enc.offsets):
            if wid != prev:
                words.append([a, b, [tid]])
            else:
                words[-1][1] = b; words[-1][2].append(tid)
            prev = wid
        return words

    @staticmethod
    def sentences(line, words, min_words=4):
        out, frm = [], 0
        letter = re.compile(r"[^\W\d_]")
        for i in range(1, len(words)):
            prev_txt = line[words[i - 1][0]:words[i - 1][1]]
            nxt = line[words[i][0]:words[i][1]]
            if prev_txt in (".", "!", "?", "…") and nxt[:1].isupper():
                n_letters = sum(1 for w in words[frm:i] if letter.search(line[w[0]:w[1]]))
                if n_letters >= min_words:
                    out.append((frm, i)); frm = i
        if words:
            out.append((frm, len(words)))
        return out

    def windows(self, text):
        wins = []  # (line_offset, words, word_from, word_to)
        pos = 0
        for line in text.split("\n"):
            ws = self.words(line)
            for a, b in self.sentences(line, ws):
                if not any(ch.isupper() for w in ws[a:b] for ch in line[w[0]:w[1]]):
                    continue  # skipLowercaseWindows
                i = a
                while i < b:
                    n, j = 0, i
                    while j < b and (n + len(ws[j][2]) <= MAX_LEN - 2 or j == i):
                        n += len(ws[j][2]); j += 1
                    wins.append((pos, ws, i, j))
                    i = j
            pos += len(line) + 1
        return wins

    def run(self, wins):
        """-> list (per window) of word predictions [start, end, tag, type, prob] with absolute char offsets."""
        import numpy as np
        results = []
        for k in range(0, len(wins), BATCH):
            batch = wins[k:k + BATCH]
            seqs = []
            for _, ws, a, b in batch:
                ids = [self.cls] + [t for w in ws[a:b] for t in w[2]][:MAX_LEN - 2] + [self.sep]
                seqs.append(ids)
            L = max(len(s) for s in seqs)
            ids = np.zeros((len(seqs), L), np.int64)
            mask = np.zeros_like(ids)
            for j, s in enumerate(seqs):
                ids[j, :len(s)] = s; mask[j, :len(s)] = 1
            logits = self.sess.run(["logits"], {"input_ids": ids, "attention_mask": mask,
                                                "token_type_ids": np.zeros_like(ids)})[0]
            for j, (off, ws, a, b) in enumerate(batch):
                probs = softmax(logits[j])
                t, preds = 1, []
                for w in ws[a:b]:
                    tag, typ, prob = decode_word(probs[t]) if t < MAX_LEN - 1 else ("O", None, 1.0)
                    preds.append([off + w[0], off + w[1], tag, typ, prob])
                    t += len(w[2])
                results.append(preds)
        return results

    def spans(self, text, post=False):
        """-> (type, start, end, score). post=True adds the model-agnostic span-boundary steps of the extension:
        bio.js bridgePunct (hyphen/apostrophe without spaces, dot after a one-letter initial), joinAdjacent (same-type
        spans separated only by spaces/tabs) and the length/letter part of filterSpans."""
        out = []
        for preds in self.run(self.windows(text)):
            if post:
                bridge_punct(preds, text)
            out += [(typ, preds[a][0], preds[b - 1][1], sc)
                    for typ, a, b, sc in merge_bio([(p[2], p[3], p[4]) for p in preds])]
        if post:
            out = filter_spans(join_adjacent(out, text), text)
        return out


JOINERS = {"-", "\u2010", "\u2011", "'", "\u2019"}


def bridge_punct(preds, text):
    """bio.js bridgePunct on [start, end, tag, type, prob] word predictions (in place)."""
    for i in range(1, len(preds) - 1):
        w, prev, nxt = preds[i], preds[i - 1], preds[i + 1]
        if w[3] or not prev[3] or prev[3] != nxt[3]:
            continue
        ch = text[w[0]:w[1]]
        tight = prev[1] == w[0] and w[1] == nxt[0]
        initial = text[prev[0]:prev[1]]
        ok = (ch in JOINERS and tight) or (ch == "." and prev[1] == w[0] and len(initial) == 1 and initial.isupper())
        if ok:
            w[2], w[3], w[4] = "I", prev[3], (prev[4] + nxt[4]) / 2
            nxt[2] = "I"


GAP_INITIALS_RE = re.compile(r"(?:[ \t\u00a0]*[^\W\d_]\.)+[ \t\u00a0]*")


def join_adjacent(spans, text, words=None):
    """bio.js joinAdjacent (version 0.5): same-type spans separated only by spaces/tabs/NBSP become one; PER spans also
    when they touch ("Комаров Р." + "А.") or are separated only by initials with a dot ("А." + "Иванов" in
    "А.А.Иванов"). Score: word-weighted mean (here weighted by span character length as a proxy)."""
    out = []
    for typ, a, b, sc in spans:
        gap = text[out[-1][2]:a] if out else "x"
        initials = typ == "PER" and (gap == "" or (GAP_INITIALS_RE.fullmatch(gap) and all(
            c.isupper() for c in re.findall(r"[^\W\d_]", gap))))
        if out and out[-1][0] == typ and (re.fullmatch(r"[ \t\u00a0]+", gap) or initials):
            t0, a0, b0, s0 = out[-1]
            n1, n2 = b0 - a0, b - a
            out[-1] = (typ, a0, b, (s0 * n1 + sc * n2) / (n1 + n2))
            continue
        out.append((typ, a, b, sc))
    return out


def filter_spans(spans, text):
    """Length/letter part of bio.js filterSpans: spans shorter than 2 characters or without a letter are dropped."""
    return [s for s in spans if s[2] - s[1] >= 2 and re.search(r"[^\W\d_]", text[s[1]:s[2]])]


# ----------------------------------------------------------------------------------------------- genre corpus

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def docx_text(path):
    parts = []
    with zipfile.ZipFile(path) as z:
        names = ["word/document.xml"] + sorted(n for n in z.namelist() if re.match(
            r"word/(header|footer)\d*\.xml$|word/(footnotes|endnotes)\.xml$", n))
        for n in names:
            root = ET.fromstring(z.read(n))
            for p in root.iter(W + "p"):
                buf = []
                for el in p.iter():
                    if el.tag == W + "t" and el.text:
                        buf.append(el.text)
                    elif el.tag == W + "tab":
                        buf.append("\t")
                    elif el.tag in (W + "br", W + "cr"):
                        buf.append("\n")
                parts.append("".join(buf))
    return "\n".join(parts)


OPF_RE = re.compile(r"^(?:ооо|оао|зао|пао|ао|нко|ано|ип|гк|фгуп|муп|llc|ltd|inc|gmbh|plc|"
                    r"общество с ограниченной ответственностью|акционерное общество|"
                    r"индивидуальный предприниматель)\b\.?\s*", re.I)
GENERIC_RE = re.compile(r"^(?:студия|агентство|бюро|компания|группа компаний|холдинг)\s+", re.I)


def norm_value(cat, v):
    v = v.replace(" ", " ").replace("ё", "е").replace("Ё", "Е").lower()
    v = re.sub(r"[«»“”„\"']", " ", v)
    v = re.sub(r"\s+", " ", v).strip(" .,;:-—()|#*")
    if cat in ("COMPANY", "ORG"):
        for _ in range(2):
            v = OPF_RE.sub("", v).strip()
            v = GENERIC_RE.sub("", v).strip()
    else:
        v = re.sub(r"(?<=\b\w)\.\s+(?=\w\.)", ".", v)  # "е. и." -> "е.и."
    return re.sub(r"\s+", " ", v).strip(" .,;:-—()|#*")


def occurrences(text, value):
    out, i = [], text.find(value)
    while i >= 0:
        out.append((i, i + len(value))); i = text.find(value, i + 1)
    return out


A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def office_text(base):
    """Text of the office formats of version 0.5 (WP12-B): XLSX — one line per cell (shared and inline strings),
    PPTX — one line per paragraph of slides and notes, CSV / JSON — the file as is (UTF-8 or CP1251)."""
    if Path(base + ".xlsx").exists():
        lines = []
        with zipfile.ZipFile(base + ".xlsx") as z:
            for n in sorted(z.namelist()):
                if n == "xl/sharedStrings.xml" or re.match(r"xl/worksheets/sheet\d+\.xml$", n):
                    root = ET.fromstring(z.read(n))
                    for si in list(root.iter(S + "si")) + list(root.iter(S + "is")):
                        lines.append("".join(t.text or "" for t in si.iter(S + "t")))
        return "\n".join(lines)
    if Path(base + ".pptx").exists():
        lines = []
        with zipfile.ZipFile(base + ".pptx") as z:
            for n in sorted(z.namelist()):
                if re.match(r"ppt/(slides/slide|notesSlides/notesSlide)\d+\.xml$", n):
                    for para in ET.fromstring(z.read(n)).iter(A + "p"):
                        lines.append("".join(t.text or "" for t in para.iter(A + "t")))
        return "\n".join(lines)
    for ext in (".csv", ".json"):
        if Path(base + ext).exists():
            raw = Path(base + ext).read_bytes()
            try:
                return raw.decode("utf-8")
            except UnicodeDecodeError:
                return raw.decode("cp1251")
    return None


def genre_docs():
    docs = []
    for gold_path in sorted((REPO / "tests" / "fixtures" / "genres").glob("*/*.gold.json")):
        base = str(gold_path)[:-len(".gold.json")]
        name = Path(base).name
        if name.endswith("-en"):
            continue  # Natasha is Russian-only
        gold = json.loads(gold_path.read_text(encoding="utf-8"))
        texts = {}
        if Path(base + ".docx").exists():
            texts["docx"] = docx_text(base + ".docx")
        if Path(base + ".pdf.txt").exists():
            texts["pdf"] = Path(base + ".pdf.txt").read_text(encoding="utf-8")
        office = office_text(base)
        if office is not None:
            texts["office"] = office
        docs.append({"name": name, "genre": gold_path.parent.name, "gold": gold, "texts": texts})
    return docs


def values_predict(values_by_doc, fmt):
    """Predictions given as values (the whole extension pipeline, pipeline_values.mjs) -> predict(text, doc) with the
    spans of every occurrence of every value in the text (for the overlap variant)."""
    def predict(text, d):
        vals = values_by_doc.get((d["genre"], d["name"], fmt), {})
        out = []
        for typ, cat in (("PER", "PERSON"), ("ORG", "COMPANY")):
            for v in vals.get(cat, []):
                occ = occurrences(text, v)
                out += [(typ, s, e) for s, e in occ] or [(typ, -1, -1, v)]
        return out
    predict.with_doc = True
    return predict


def doc_level(docs, fmt, predict):
    """predict(text) -> list of (type, start, end). Exact-value and overlap document-level P/R/F1 for PER and ORG.
    A predict with `with_doc` gets (text, doc) and may return (type, -1, -1, value) for a value absent from the text."""
    cat_of = {"PER": "PERSON", "ORG": "COMPANY"}
    agg = {t: {"tp": 0, "fp": 0, "fn": 0, "ov_found": 0, "ov_pred_ok": 0, "ov_pred": 0, "gold": 0,
               "gold_absent": 0, "negative_hits": 0} for t in cat_of}
    per_doc = []
    for d in docs:
        if fmt not in d["texts"]:
            continue
        text = d["texts"][fmt]
        pred = predict(text, d) if getattr(predict, "with_doc", False) else predict(text)
        row = {"name": d["name"], "genre": d["genre"]}
        for t, cat in cat_of.items():
            a = agg[t]
            gold_vals = [e["value"] for e in d["gold"]["entities"] if e["category"] == cat]
            present = [v for v in gold_vals if occurrences(text, v)]
            a["gold_absent"] += len(set(gold_vals) - set(present))
            g = {norm_value(cat, v) for v in present}
            g.discard("")
            ps = [(x[1], x[2]) for x in pred if x[0] == t and x[1] >= 0]
            p = {norm_value(cat, text[s:e]) for s, e in ps} | {norm_value(cat, x[3]) for x in pred
                                                                if x[0] == t and x[1] < 0}
            p.discard("")
            negs = {norm_value(cat, n["value"]) for n in d["gold"].get("negatives", [])
                    if n.get("category") == cat and "mode" not in n}
            a["tp"] += len(p & g); a["fp"] += len(p - g); a["fn"] += len(g - p); a["gold"] += len(g)
            a["negative_hits"] += len(p & negs)
            occ = [(v, o) for v in present for o in occurrences(text, v)]
            found = {v for v, (s, e) in occ if any(ps_ < e and pe > s for ps_, pe in ps)}
            a["ov_found"] += len({norm_value(cat, v) for v in found} - {""})
            a["ov_pred"] += len(ps)
            a["ov_pred_ok"] += sum(1 for ps_, pe in ps if any(ps_ < e and pe > s for _, (s, e) in occ))
            row[t] = {"gold": sorted(g), "missed": sorted(g - p), "extra": sorted(p - g)}
        per_doc.append(row)
    out = {}
    for t, a in agg.items():
        pr = a["tp"] / (a["tp"] + a["fp"]) if a["tp"] + a["fp"] else 0.0
        rc = a["tp"] / (a["tp"] + a["fn"]) if a["tp"] + a["fn"] else 0.0
        out[cat_of[t]] = {"precision": round(pr, 4), "recall": round(rc, 4),
                          "f1": round(2 * pr * rc / (pr + rc), 4) if pr + rc else 0.0,
                          "gold_values": a["gold"], "tp": a["tp"], "fp": a["fp"], "fn": a["fn"],
                          "overlap_recall": round(a["ov_found"] / a["gold"], 4) if a["gold"] else 0.0,
                          "overlap_precision": round(a["ov_pred_ok"] / a["ov_pred"], 4) if a["ov_pred"] else 0.0,
                          "predicted_spans": a["ov_pred"], "gold_values_absent_from_text": a["gold_absent"],
                          "negative_values_predicted": a["negative_hits"]}
    return out, per_doc


# ----------------------------------------------------------------------------------------------- benchmark workers

def bench_texts(run_id, n):
    from datasets import load_from_disk
    split = load_from_disk(str(ROOT / "runs" / run_id / "data"))["test_ru"]
    return [" ".join(t) for t in split.select(range(n))["tokens"]]


def worker(kind, args):
    """Runs in a fresh process with one CPU thread. Prints JSON."""
    texts = bench_texts(args.run_id, args.bench_sentences)  # loads datasets/numpy/pyarrow first (both workers)
    t_import = time.perf_counter()
    if kind == "ours":
        import onnxruntime  # noqa: F401
        from tokenizers import BertWordPieceTokenizer  # noqa: F401
    else:
        import natasha  # noqa: F401
    import_ms = (time.perf_counter() - t_import) * 1000  # library import after numpy is already loaded
    t0 = time.perf_counter()
    if kind == "ours":
        model = OursText(Path(args.onnx), Path(args.onnx).parent / "vocab.txt", threads=1)
        run_one = model.spans
    else:
        model = Natasha()
        run_one = model.spans
    load_ms = (time.perf_counter() - t0) * 1000
    t1 = time.perf_counter()
    run_one(texts[0])
    first_ms = (time.perf_counter() - t1) * 1000
    res = {"kind": kind, "sentences": len(texts), "import_ms": round(import_ms, 1), "load_ms": round(load_ms, 1),
           "first_call_ms": round(first_ms, 1), "cold_start_ms": round(load_ms + first_ms, 1)}
    reps = []
    for _ in range(args.bench_repeats):
        t = time.perf_counter()
        if kind == "ours":
            [merge_bio([(p[2], p[3], p[4]) for p in preds])  # batches of 8 sentence windows
             for preds in model.run([w for s in texts for w in model.windows(s)])]
        else:
            for s in texts:
                run_one(s)
        reps.append((time.perf_counter() - t) * 1000)
    res["ms_per_1000_sentences"] = round(statistics.median(reps) * 1000 / len(texts), 1)
    res["runs_ms"] = [round(x, 1) for x in reps]
    if kind == "ours":
        reps1 = []
        for _ in range(args.bench_repeats):
            t = time.perf_counter()
            for s in texts:
                model.spans(s)  # batch 1: one sentence per call
            reps1.append((time.perf_counter() - t) * 1000)
        res["ms_per_1000_sentences_batch1"] = round(statistics.median(reps1) * 1000 / len(texts), 1)
    else:
        reps1 = []
        joined = "\n".join(texts)
        for _ in range(args.bench_repeats):
            t = time.perf_counter()
            run_one(joined)
            reps1.append((time.perf_counter() - t) * 1000)
        res["ms_per_1000_sentences_one_doc"] = round(statistics.median(reps1) * 1000 / len(texts), 1)
    print(json.dumps(res))


def run_worker(kind, args):
    env = dict(os.environ, OMP_NUM_THREADS="1", MKL_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1",
               NUMEXPR_NUM_THREADS="1", TOKENIZERS_PARALLELISM="false", RAYON_NUM_THREADS="1",
               RAYON_RS_NUM_CPUS="1")
    cmd = [sys.executable, str(Path(__file__).resolve()), "--worker", kind, "--run-id", args.run_id,
           "--onnx", args.onnx, "--bench-sentences", str(args.bench_sentences),
           "--bench-repeats", str(args.bench_repeats)]
    out = subprocess.run(cmd, env=env, capture_output=True, text=True, check=True)
    return json.loads(out.stdout.strip().splitlines()[-1])


# ----------------------------------------------------------------------------------------------- main

def file_info(p):
    p = Path(p)
    return {"path": str(p.relative_to(REPO)) if p.is_relative_to(REPO) else str(p), "bytes": p.stat().st_size,
            "mb": round(p.stat().st_size / 1e6, 2)}


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-id", default="rubert-tiny2-ner-ruen-1.2.0")
    ap.add_argument("--onnx", default=str(REPO / "models-src" / "rubert-tiny2-ner-ruen" / "model.onnx"))
    ap.add_argument("--expect-version", default="1.2.0")
    ap.add_argument("--pipeline-json", action="append", default=[], metavar="LABEL=PATH",
                    help="values found by the whole extension pipeline (pipeline_values.mjs), e.g. "
                         "pipeline-1.2.0=runs/compare-natasha/pipeline-1.2.0.json; repeatable")
    ap.add_argument("--out", default=str(ROOT / "runs" / "compare-natasha"))
    ap.add_argument("--skip-torch", action="store_true")
    ap.add_argument("--skip-bench", action="store_true")
    ap.add_argument("--bench-sentences", type=int, default=1000)
    ap.add_argument("--bench-repeats", type=int, default=3)
    ap.add_argument("--worker", choices=["ours", "natasha"], help=argparse.SUPPRESS)
    args = ap.parse_args()
    if args.worker:
        return worker(args.worker, args)

    import numpy as np
    sys.path.insert(0, str(ROOT))
    from common import ort_logits, ort_session
    from datasets import load_from_disk
    import natasha
    import navec
    import slovnet

    onnx_path = Path(args.onnx)
    pack = json.loads((onnx_path.parent / "pack.src.json").read_text(encoding="utf-8"))
    assert pack["version"] == args.expect_version, f"pack version {pack['version']} != {args.expect_version}"
    run = ROOT / "runs" / args.run_id
    int8_run = run / "onnx" / "model.int8.onnx"
    model_sha = sha256(onnx_path)
    result = {"date": time.strftime("%Y-%m-%d"), "machine": {"cpu": platform.processor() or platform.machine(),
                                                             "python": platform.python_version()},
              "ours": {"pack_id": pack["id"], "pack_version": pack["version"], "onnx": file_info(onnx_path),
                       "onnx_sha256": model_sha,
                       "same_as_run_int8": int8_run.exists() and sha256(int8_run) == model_sha,
                       "thresholds": THRESHOLDS},
              "natasha": {"versions": {"natasha": getattr(natasha, "__version__", None) or _dist_version("natasha"),
                                       "slovnet": _dist_version("slovnet"), "navec": _dist_version("navec"),
                                       "razdel": _dist_version("razdel")}}}
    try:
        result["machine"]["cpu"] = next(line.split(":", 1)[1].strip() for line in open("/proc/cpuinfo")
                                        if line.startswith("model name"))
    except (OSError, StopIteration):
        pass

    data = load_from_disk(str(run / "data"))
    synth = data["test_synth_genre"]
    ru_idx = [i for i, lang in enumerate(synth["lang"]) if lang == "ru"]
    # WikiANN ru annotates list/title fragments "Surname , Name" as one PER span with the comma inside; Natasha
    # (and running text in general) does not. test_ru_nocomma drops sentences with a comma inside a gold span.
    wr = data["test_ru"]
    nocomma = [i for i, (toks, tags) in enumerate(zip(wr["tokens"], wr["ner_tags"]))
               if not any("," in toks[a:b] for _, a, b in bio_spans([LABELS[t] for t in tags]))]
    sets = {"test_ru": wr, "test_ru_nocomma": wr.select(nocomma), "test_factru": data["test_factru"],
            "test_synth_genre_ru": synth.select(ru_idx), "test_synth_genre_all": synth}

    # --- our models
    sess = ort_session(onnx_path)
    model_t = None
    if not args.skip_torch:
        import torch
        from common import torch_logits
        from transformers import AutoModelForTokenClassification
        torch.set_num_threads(max(1, (os.cpu_count() or 2) // 2))
        model_t = AutoModelForTokenClassification.from_pretrained(str(run / "model")).eval()

    metrics = {}
    natasha_proj = {}
    nat = Natasha()
    for name, split in sets.items():
        y_true = [[LABELS[t] for t in tags] for tags in split["ner_tags"]]
        neg = split["negative"] if "negative" in split.column_names else None
        trunc = sum(1 for wid, tags in zip(split["word_ids"], split["ner_tags"])
                    if max(w for w in wid if w >= 0) + 1 < len(tags))
        m = {"sentences": len(split), "truncated_sentences_ours": trunc}
        variants = [("ours-int8", ort_logits(sess, split, batch_size=128))]
        if model_t is not None:
            variants.append(("ours-fp32", torch_logits(model_t, split)))
        for vname, logits in variants:
            dec = [merge_bio(words_from_logits(lg, wid, len(tags)))
                   for lg, wid, tags in zip(logits, split["word_ids"], split["ner_tags"])]
            for tname, th in THRESHOLDS.items():
                y_pred = [spans_to_tags(len(tags), apply_threshold(sp, th))
                          for sp, tags in zip(dec, split["ner_tags"])]
                r = {"report": seq_report(y_true, y_pred), "overlap_f1": overlap_report(y_true, y_pred)}
                if neg is not None:
                    r["negatives"] = negatives_report(y_pred, neg)
                m[f"{vname}@{tname}"] = r
        if name == "test_synth_genre_all":
            metrics[name] = m  # ours only: English sentences are out of scope for Natasha
            continue
        stats = {"spans": 0, "misaligned": 0, "start_inside_word": 0, "end_inside_word": 0, "no_word": 0,
                 "word_conflicts": 0}
        y_pred = []
        t = time.perf_counter()
        for tokens in split["tokens"]:
            sp = nat.spans(" ".join(tokens))
            natasha_types(sp)
            y_pred.append(project_to_words(tokens, sp, stats))
        stats["seconds"] = round(time.perf_counter() - t, 1)
        stats["misaligned_share"] = round(stats["misaligned"] / stats["spans"], 4) if stats["spans"] else 0.0
        natasha_proj[name] = stats
        r = {"report": seq_report(y_true, y_pred), "overlap_f1": overlap_report(y_true, y_pred), "projection": stats}
        if neg is not None:
            r["negatives"] = negatives_report(y_pred, neg)
        m["natasha"] = r
        metrics[name] = m
        print(f"{name}: done ({len(split)} sentences)", file=sys.stderr)
    result["sentence_sets"] = metrics

    # --- genre corpus (document level)
    docs = genre_docs()
    ours_text = OursText(onnx_path, onnx_path.parent / "vocab.txt")
    genre = {"documents": {fmt: sum(1 for d in docs if fmt in d["texts"]) for fmt in ("docx", "pdf", "office")},
             "names": [d["name"] for d in docs]}
    def nat_post(text, lines=True):
        sp = nat.spans_lines(text) if lines else nat.spans(text)
        return [(t, a, b) for t, a, b, _ in filter_spans(join_adjacent([(t, a, b, 1.0) for t, a, b in sp], text), text)]

    pipelines = {}
    for item in args.pipeline_json:
        label, _, path = item.partition("=")
        rows = json.loads(Path(path).read_text(encoding="utf-8"))
        pipelines[label] = {(r["genre"], r["name"], {"docx": "docx", "pdf": "pdf"}.get(r["format"], "office")): r
                            for r in rows["docs"]}
        genre[f"pipeline:{label}"] = {k: v for k, v in rows.items() if k != "docs"}
    for fmt in ("docx", "pdf", "office"):
        for label, by_doc in pipelines.items():
            agg, per_doc = doc_level(docs, fmt, values_predict(by_doc, fmt))
            genre[f"{fmt}/{label}"] = {"aggregate": agg, "per_doc": per_doc}
        for post in (False, True):
            for tname in ("t0.7", "ext_defaults"):
                th = THRESHOLDS[tname]
                pred = lambda text, th=th, post=post: [(t, s, e) for t, s, e, sc in ours_text.spans(text, post=post)  # noqa: E731
                                                       if sc >= th[t]]
                agg, per_doc = doc_level(docs, fmt, pred)
                genre[f"{fmt}/ours-int8@{tname}{'+post' if post else ''}"] = {"aggregate": agg, "per_doc": per_doc}
        for key, fn in (("natasha", nat.spans_lines), ("natasha+post", nat_post),
                        ("natasha-whole-text", nat.spans),
                        ("natasha-whole-text+post", lambda text: nat_post(text, lines=False))):
            agg, per_doc = doc_level(docs, fmt, fn)
            genre[f"{fmt}/{key}"] = {"aggregate": agg, "per_doc": per_doc}
    result["genre_corpus"] = genre

    # --- sizes
    nat_dir = Path(natasha.__file__).parent / "data"
    nat_files = [nat_dir / "emb" / "navec_news_v1_1B_250K_300d_100q.tar", nat_dir / "model" / "slovnet_ner_news_v1.tar"]
    result["size"] = {
        "ours": {"model.onnx": file_info(onnx_path), "vocab.txt": file_info(onnx_path.parent / "vocab.txt"),
                 "total_bytes": onnx_path.stat().st_size + (onnx_path.parent / "vocab.txt").stat().st_size,
                 "runtime_note": "onnxruntime-web WASM (ort-wasm-simd-threaded.wasm, ~14.2 MB) is part of the extension"},
        "natasha": {"files": [file_info(p) for p in nat_files],
                    "total_bytes": sum(p.stat().st_size for p in nat_files),
                    "runtime_note": "numpy + pure-Python packages (natasha, slovnet, navec, razdel)"},
    }

    # --- speed
    if not args.skip_bench:
        result["speed"] = {"threads": 1, "sentences": args.bench_sentences, "source": "first N sentences of test_ru",
                           "ours": run_worker("ours", args), "natasha": run_worker("natasha", args)}

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "compare.json"
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print_summary(result)
    print(json.dumps({"compare.json": str(out_path)}))


def _dist_version(name):
    from importlib.metadata import PackageNotFoundError, version
    try:
        return version(name)
    except PackageNotFoundError:
        return None


def print_summary(r):
    f = lambda x: f"{x:.3f}"  # noqa: E731
    print("\n| Набор | Модель | PER | ORG | LOC | micro | overlap PER/ORG/LOC/micro |")
    print("|---|---|---|---|---|---|---|")
    for name, m in r["sentence_sets"].items():
        for key in ("ours-int8@t0.7", "ours-int8@ext_defaults", "ours-int8@none", "ours-fp32@t0.7", "natasha"):
            if key not in m:
                continue
            rep = m[key]["report"]
            cells = [f(rep[t]["f1-score"]) if t in rep else "—" for t in TYPES]
            ov = m[key]["overlap_f1"]
            print(f"| {name} | {key} | {' | '.join(cells)} | {f(rep['micro avg']['f1-score'])} | "
                  f"{'/'.join(f(ov[t]) for t in (*TYPES, 'micro'))} |")
    for name, m in r["sentence_sets"].items():
        for key in ("ours-int8@t0.7", "ours-int8@ext_defaults", "natasha"):
            if key in m and "negatives" in m[key]:
                print(f"{name} {key} negatives: {m[key]['negatives']}")
    for name, m in r["sentence_sets"].items():
        if "natasha" in m:
            print(f"{name} natasha projection: {m['natasha']['projection']}")
    for k, v in r["genre_corpus"].items():
        if isinstance(v, dict) and "aggregate" in v:
            a = v["aggregate"]
            print(f"genre {k}: " + "; ".join(
                f"{c} P {x['precision']:.3f} R {x['recall']:.3f} F1 {x['f1']:.3f} (overlap R {x['overlap_recall']:.3f}, "
                f"P {x['overlap_precision']:.3f}; neg {x['negative_values_predicted']})" for c, x in a.items()))
    print("size:", {k: v["total_bytes"] for k, v in r["size"].items()})
    if "speed" in r:
        print("speed:", json.dumps(r["speed"], ensure_ascii=False))


if __name__ == "__main__":
    main()
