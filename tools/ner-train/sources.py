"""Loaders of the training corpora listed in config.yaml data.sources[].

Every loader returns {"train": rows, "validation": rows | None, "test": rows | None} where rows is a dict of columns
tokens / ner_tags (label ids in config order) / lang. Labels outside PER/ORG/LOC become O.

Kinds:
  wikiann — Hugging Face datasets `unimelb-nlp/wikiann` (config ru / en), tags already in the right order;
  factru  — factRuEval-2016 (dialogue-evaluation, MIT; texts from OpenCorpora, CC BY-SA 3.0), downloaded from a
            pinned commit; object layer Person -> PER, Org -> ORG, Location / LocOrg -> LOC, Project -> O.
  nerel   — NEREL v1.1 (Wikinews, gold nested annotation; no explicit license — owner decision 26.10.2026), pinned
            commit; PERSON -> PER, ORGANIZATION -> ORG, CITY / COUNTRY / STATE_OR_PROVINCE / LOCATION / DISTRICT -> LOC,
            the rest -> O; the outermost mapped mention wins; train / dev / test splits of the corpus.
  nerus   — Nerus (Lenta.ru news, silver annotation by Slovnet BERT NER; no explicit license on the texts — owner
            decision 26.10.2026); a deterministic document sample of the 2 GB CoNLL-U dump, cached in .cache/nerus.

Rows may carry an extra "doc" column (document id) used by prepare.py for the test-overlap check and an "ignore" column
(per word: 1 = no hard label, e.g. NEREL words of dropped descriptive organisations); prepare.py applies "ignore" only for
sources with `ignore_types` in config.yaml and drops both columns from the test / validation splits.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import random
import re
import tarfile
import urllib.request
from pathlib import Path

from common import ROOT

FACTRU_TYPES = {"Person": "PER", "Org": "ORG", "Location": "LOC", "LocOrg": "LOC"}
# span types that carry the name itself; descriptors ("компания", "город"), jobs and geo adjectives are left out
FACTRU_NAME_SPANS = {"PER": {"name", "surname", "patronymic", "nickname"}, "ORG": {"org_name", "loc_name", "geo_adj"},
                     "LOC": {"loc_name"}}
OPEN_QUOTES = {"«", '"', "“", "„", "'"}
CLOSE_QUOTES = {"»", '"', "”", "“", "'"}
LEGAL_FORMS = {"ООО", "ОАО", "ЗАО", "ПАО", "АО", "НАО", "АНО", "НКО", "ФГУП", "ГУП", "МУП", "ИП", "ТОО", "НПО", "ФГБУ",
               "ГБУ", "ФКУ", "LLC", "Inc", "Ltd"}


def load_source(src: dict, labels: list[str]) -> dict:
    kind = src["kind"]
    if kind == "wikiann":
        return _load_wikiann(src, labels)
    if kind == "factru":
        return _load_factru(src, labels)
    if kind == "nerel":
        return _load_nerel(src, labels)
    if kind == "nerus":
        return _load_nerus(src, labels)
    raise ValueError(f"unknown source kind: {kind}")


def _load_wikiann(src, labels):
    from datasets import load_dataset
    ds = load_dataset(src["dataset"], src["config"])
    names = ds["train"].features["ner_tags"].feature.names
    assert names == labels, f"label order mismatch for {src['id']}: {names}"
    out = {}
    for split in ("train", "validation", "test"):
        part = ds[split]
        out[split] = {"tokens": part["tokens"], "ner_tags": part["ner_tags"], "lang": [src["lang"]] * len(part)}
    return out


# ---- factRuEval-2016 ------------------------------------------------------------------------------------------

def _download_github(src, repo: str, name: str) -> Path:
    """Archive of a pinned commit of a GitHub repository (sha256 checked), extracted into .cache/<name>/."""
    cache = ROOT / ".cache" / name
    cache.mkdir(parents=True, exist_ok=True)
    stem = repo.split("/")[1]
    tgz = cache / f"{stem}-{src['commit']}.tar.gz"
    if not tgz.exists():
        url = f"https://codeload.github.com/{repo}/tar.gz/{src['commit']}"
        urllib.request.urlretrieve(url, tgz)
    digest = hashlib.sha256(tgz.read_bytes()).hexdigest()
    assert digest == src["sha256"], f"{repo} archive sha256 mismatch: {digest}"
    root = cache / f"{stem}-{src['commit']}"
    if not root.exists():
        with tarfile.open(tgz) as tf:
            tf.extractall(cache, filter="data")
    return root


def _download_factru(src) -> Path:
    return _download_github(src, "dialogue-evaluation/factRuEval-2016", "factru")


def _read_doc(stem: Path):
    """Sentences of one document: list of (tokens, tags)."""
    toks, sent_of, sents = [], [], [[]]
    id2idx = {}
    for line in stem.with_suffix(".tokens").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            if sents[-1]:
                sents.append([])
            continue
        tid, _start, _len, text = line.split(" ", 3)
        id2idx[tid] = len(toks)
        sents[-1].append(len(toks))
        sent_of.append(len(sents) - 1)
        toks.append(text)
    if not sents[-1]:
        sents.pop()
    spans = {}
    for line in stem.with_suffix(".spans").read_text(encoding="utf-8").splitlines():
        f = line.split("#")[0].split()
        if len(f) < 6:
            continue
        sid, typ, first, ntok = f[0], f[1], f[4], int(f[5])
        if first not in id2idx:
            continue
        i0 = id2idx[first]
        spans[sid] = (typ, list(range(i0, i0 + ntok)))
    mentions = []
    for line in stem.with_suffix(".objects").read_text(encoding="utf-8").splitlines():
        f = line.split("#")[0].split()
        if len(f) < 3 or f[1] not in FACTRU_TYPES:
            continue
        lab = FACTRU_TYPES[f[1]]
        idx = [i for s in f[2:] if s in spans and spans[s][0] in FACTRU_NAME_SPANS[lab] for i in spans[s][1]]
        if lab == "ORG" and not any(spans[s][0] == "org_name" for s in f[2:] if s in spans):
            continue  # descriptor-only organisation mention ("дипмиссия", "правительство")
        if not idx:
            continue
        a, b = min(idx), max(idx) + 1
        if sent_of[a] != sent_of[b - 1]:
            continue
        if lab == "ORG":  # anonymizer convention: quotes and a legal form in front belong to the organisation
            if a > 0 and b < len(toks) and toks[a - 1] in OPEN_QUOTES and toks[b] in CLOSE_QUOTES \
                    and sent_of[a - 1] == sent_of[a] and sent_of[b] == sent_of[a]:
                a, b = a - 1, b + 1
            if a > 0 and toks[a - 1].rstrip(".") in LEGAL_FORMS and sent_of[a - 1] == sent_of[a]:
                a -= 1
        mentions.append((b - a, a, b, lab))
    tags = ["O"] * len(toks)
    taken = [False] * len(toks)
    for _, a, b, lab in sorted(mentions, key=lambda m: (-m[0], m[1])):  # outermost mention wins
        if any(taken[a:b]):
            continue
        for i in range(a, b):
            taken[i] = True
            tags[i] = ("B-" if i == a else "I-") + lab
    return [([toks[i] for i in s], [tags[i] for i in s]) for s in sents]


def _load_factru(src, labels):
    root = _download_factru(src)
    l2i = {l: i for i, l in enumerate(labels)}
    stems = sorted({p.with_suffix("") for d in ("devset", "testset") for p in (root / d).glob("*.objects")})
    holdout = float(src.get("holdout_docs", 0.2))
    out = {"train": {"tokens": [], "ner_tags": [], "lang": []}, "test": {"tokens": [], "ner_tags": [], "lang": []}}
    for stem in stems:
        # deterministic document-level hold-out by a hash of the file name
        h = int(hashlib.sha256(stem.name.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
        part = out["test" if h < holdout else "train"]
        for toks, tags in _read_doc(stem):
            if not toks:
                continue
            part["tokens"].append(toks)
            part["ner_tags"].append([l2i[t] for t in tags])
            part["lang"].append("ru")
    out["validation"] = None
    return out


# ---- shared: anonymizer convention for ORG spans ------------------------------------------------------------------

def _extend_org(toks, tags, a, b, same_sent=lambda i, j: True):
    """ORG [a, b) -> with enclosing quotes and a legal form in front (the anonymizer convention, as for factRuEval)."""
    if a > 0 and b < len(toks) and toks[a - 1] in OPEN_QUOTES and toks[b] in CLOSE_QUOTES \
            and tags[a - 1] == "O" and tags[b] == "O" and same_sent(a - 1, b):
        a, b = a - 1, b + 1
    if a > 0 and toks[a - 1].rstrip(".") in LEGAL_FORMS and tags[a - 1] == "O" and same_sent(a - 1, a):
        a -= 1
    return a, b


# ---- NEREL --------------------------------------------------------------------------------------------------------

NEREL_TYPES = {"PERSON": "PER", "ORGANIZATION": "ORG", "CITY": "LOC", "COUNTRY": "LOC", "STATE_OR_PROVINCE": "LOC",
               "LOCATION": "LOC", "DISTRICT": "LOC"}
WORD_RE = re.compile(r"\w+(?:[-']\w+)*|[^\w\s]", re.UNICODE)  # same tokenization as synth.py
SENT_END = {".", "!", "?", "…"}
# a dot after these tokens does not end a sentence (one-letter initials are handled separately)
NO_BREAK_AFTER = {"г", "гг", "ул", "им", "т", "д", "св", "проф", "акад", "ст", "руб", "млн", "млрд", "тыс", "см", "др",
                  "пр", "пос", "обл", "р", "к", "кв", "корп", "стр", "тел", "англ", "нем", "франц", "лат", "Mr", "Mrs",
                  "Ms", "Dr", "St", "Inc", "Ltd", "Co", "Jr", "Sr", "vs", "e", "i"}


ADJ_RE = re.compile(r"(?:ск|цк|н)(?:ий|ый|ой|ая|ое|ие|ые|ого|ому|ым|ом|ей|ую|их|ими|им)$")


def _nerel_docs(root: Path, split: str):
    for txt in sorted((root / split).glob("*.txt")):
        ann = txt.with_suffix(".ann")
        if not ann.exists():
            continue
        text = txt.read_text(encoding="utf-8")
        ents = []
        for line in ann.read_text(encoding="utf-8").splitlines():
            if not line.startswith("T"):
                continue
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            f = parts[1].split(" ")
            if ";" in parts[1]:
                continue  # discontinuous mention (rare, 127 in train)
            ents.append((f[0], int(f[1]), int(f[2])))
        yield txt.stem, text, ents


def _nerel_lower_vocab(root: Path) -> set:
    """Words written in lowercase somewhere in NEREL (to tell descriptive organisation mentions from names)."""
    vocab = set()
    for split in ("train", "dev", "test"):
        for txt in (root / split).glob("*.txt"):
            for w in WORD_RE.findall(txt.read_text(encoding="utf-8")):
                if w[:1].islower():
                    vocab.add(w)
    return vocab


def _proper_token(t: str, lower_vocab: set) -> bool:
    if not t[:1].isupper():
        return False
    if len(t) > 1 and t.isupper():
        return True  # abbreviation (МВД, ООН)
    return t.lower() not in lower_vocab


def _nerel_doc_rows(name, text, ents, lower_vocab, stats):
    toks = [(m.group(), m.start(), m.end()) for m in WORD_RE.finditer(text)]
    starts = {s: i for i, (_, s, _) in enumerate(toks)}
    ends = {e: i for i, (_, _, e) in enumerate(toks)}
    # mapped mentions aligned to token boundaries
    ments = []
    for typ, s, e in ents:
        lab = NEREL_TYPES.get(typ)
        if not lab:
            continue
        while s < e and text[s].isspace():
            s += 1
        while e > s and text[e - 1].isspace():
            e -= 1
        if s not in starts or e not in ends:
            stats["misaligned"] += 1
            continue
        ments.append([lab, starts[s], ends[e] + 1])
    words = [t for t, _, _ in toks]
    # sentence boundaries (a boundary never splits a mapped mention)
    inside = [False] * (len(toks) + 1)
    for _, a, b in ments:
        for i in range(a + 1, b):
            inside[i] = True
    sent_start = [0]
    for i in range(1, len(toks)):
        gap = text[toks[i - 1][2]:toks[i][1]]
        brk = "\n" in gap
        if not brk and words[i - 1] in SENT_END and i >= 2:
            prev = words[i - 2]
            nxt = words[i]
            initial = len(prev) == 1 and prev.isupper()
            brk = (not initial and prev not in NO_BREAK_AFTER and (nxt[:1].isupper() or nxt[:1].isdigit()
                                                                   or nxt in OPEN_QUOTES or nxt in {"—", "-", "("}))
        if brk and not inside[i]:
            sent_start.append(i)
    sent_of = [0] * len(toks)
    k = 0
    for i in range(len(toks)):
        while k + 1 < len(sent_start) and sent_start[k + 1] <= i:
            k += 1
        sent_of[i] = k
    # descriptive organisations ("Правоохранительные органы Киргизии" at a sentence start, "органы власти") are dropped, the
    # mentions nested in them (Киргизии -> LOC) take over; a name, an abbreviation or quotes keep the ORG
    keep, dropped = [], []
    for m in ments:
        lab, a, b = m
        if lab == "ORG":  # leading lowercase words are a descriptor ("отдела расследования «Лаборатории Касперского»")
            while a < b - 1 and words[a][:1].islower():
                a += 1
            m[1] = a
        if not any(w[:1].isupper() or w[:1].isdigit() or w in OPEN_QUOTES for w in words[a:b]):
            stats["lowercase_dropped"] += 1  # "полицией", "талибов" as ORG
            if lab == "ORG":
                dropped.append((a, b))
            continue
        if lab == "LOC" and b - a == 1 and ADJ_RE.search(words[a].lower()):
            stats["adjective_loc_dropped"] += 1  # "Российский" as COUNTRY
            continue
        if lab == "ORG" and b - a > 1:
            covered = set()
            for lab2, a2, b2 in ments:
                if (a2, b2) != (a, b) and a <= a2 and b2 <= b:
                    covered.update(range(a2, b2))
            own = [i for i in range(a, b) if i not in covered and words[i][:1].isalpha()]
            quoted = any(words[i] in OPEN_QUOTES for i in range(a, b))
            first_sent = a == 0 or sent_of[a - 1] != sent_of[a]
            # a capital letter inside a sentence marks a name ("Европейский союз", "Министерство обороны"); the first
            # word of a sentence counts only when it is never written in lowercase in the corpus
            proper = quoted or any(words[i][:1].isupper() and (not (i == a and first_sent)
                                                               or _proper_token(words[i], lower_vocab))
                                   for i in own)
            if not proper:
                stats["org_descriptive_dropped"] += 1
                dropped.append((a, b))
                continue
        keep.append(m)
    tags = ["O"] * len(toks)
    for lab, a, b in sorted(keep, key=lambda m: (-(m[2] - m[1]), m[1])):  # outermost mapped mention wins
        if any(t != "O" for t in tags[a:b]):
            continue
        if lab == "ORG":
            a, b = _extend_org(words, tags, a, b, lambda i, j: sent_of[i] == sent_of[j])
        for i in range(a, b):
            tags[i] = ("B-" if i == a else "I-") + lab
        stats[lab] += 1
    ignore = [0] * len(toks)  # words of dropped organisation mentions (may be ORG by another convention)
    for a, b in dropped:
        for i in range(a, b):
            if tags[i] == "O":
                ignore[i] = 1
    rows = []
    for k, a in enumerate(sent_start):
        b = sent_start[k + 1] if k + 1 < len(sent_start) else len(toks)
        if b - a < 2:
            continue
        rows.append((words[a:b], tags[a:b], ignore[a:b]))
    return rows


def _load_nerel(src, labels):
    root = _download_github(src, "nerel-ds/NEREL", "nerel") / src.get("version_dir", "NEREL-v1.1")
    l2i = {l: i for i, l in enumerate(labels)}
    lower_vocab = _nerel_lower_vocab(root)
    out = {}
    stats = {"misaligned": 0, "org_descriptive_dropped": 0, "lowercase_dropped": 0, "adjective_loc_dropped": 0,
             "PER": 0, "ORG": 0, "LOC": 0}
    for split, key in (("train", "train"), ("dev", "validation"), ("test", "test")):
        rows = {"tokens": [], "ner_tags": [], "lang": [], "doc": [], "ignore": []}
        for name, text, ents in _nerel_docs(root, split):
            for toks, tags, ign in _nerel_doc_rows(name, text, ents, lower_vocab, stats):
                rows["ignore"].append(ign)
                rows["tokens"].append(toks)
                rows["ner_tags"].append([l2i[t] for t in tags])
                rows["lang"].append("ru")
                rows["doc"].append(f"nerel/{split}/{name}")
        out[key] = rows
    out["stats"] = stats
    return out


# ---- Nerus --------------------------------------------------------------------------------------------------------

def _nerus_pool(src) -> list:
    """Deterministic document sample of the Nerus dump: a document is taken when hash(seed, doc id) < doc_share.
    Cached as JSON lines [doc, tokens, tags]; tags in Nerus BIO (B-PER / I-ORG / O)."""
    cache = ROOT / ".cache" / "nerus"
    dump = cache / src.get("file", "nerus_lenta.conllu.gz")
    if not dump.exists():
        cache.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(src["download"], str(dump) + ".part")
        Path(str(dump) + ".part").rename(dump)
    share, seed = float(src["doc_share"]), int(src.get("seed", 13))
    pool_path = cache / f"pool-{share}-{seed}.jsonl.gz"
    if pool_path.exists():
        with gzip.open(pool_path, "rt", encoding="utf-8") as f:
            return [json.loads(l) for l in f]
    if src.get("sha256"):
        h = hashlib.sha256()
        with open(dump, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 24), b""):
                h.update(chunk)
        assert h.hexdigest() == src["sha256"], f"Nerus dump sha256 mismatch: {h.hexdigest()}"
    pool, doc, take, toks, tags = [], None, False, [], []
    with gzip.open(dump, "rt", encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                if line.startswith("# newdoc id"):
                    doc = line.split("=", 1)[1].strip()
                    hv = int(hashlib.sha256(f"{seed}:{doc}".encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
                    take = hv < share
                continue
            if not line.strip():
                if take and toks:
                    pool.append([doc, toks, tags])
                toks, tags = [], []
                continue
            if not take:
                continue
            cols = line.rstrip("\n").split("\t")
            if len(cols) < 10 or "-" in cols[0] or "." in cols[0]:
                continue
            tag = "O"
            for kv in cols[9].split("|"):
                if kv.startswith("Tag="):
                    tag = kv[4:]
            toks.append(cols[1])
            tags.append(tag)
    if take and toks:
        pool.append([doc, toks, tags])
    with gzip.open(pool_path, "wt", encoding="utf-8") as f:
        for r in pool:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    return pool


def _load_nerus(src, labels):
    l2i = {l: i for i, l in enumerate(labels)}
    pool = _nerus_pool(src)
    rng = random.Random(int(src.get("seed", 13)))
    n = int(src.get("sentences", len(pool)))
    idx = sorted(rng.sample(range(len(pool)), min(n, len(pool))))
    rows = {"tokens": [], "ner_tags": [], "lang": [], "doc": []}
    stats = {"pool_sentences": len(pool), "pool_docs": len({p[0] for p in pool}), "PER": 0, "ORG": 0, "LOC": 0}
    for i in idx:
        doc, toks, raw = pool[i]
        tags = [t if t[2:] in ("PER", "ORG", "LOC") else "O" for t in raw]
        # lenient BIO -> spans, ORG with quotes / legal form, back to strict BIO
        spans, cur = [], None
        for j, t in enumerate(tags):
            if t == "O":
                cur = None
                continue
            if t.startswith("B-") or cur is None or cur[0] != t[2:]:
                cur = [t[2:], j, j + 1]
                spans.append(cur)
            else:
                cur[2] = j + 1
        out = ["O"] * len(toks)
        for lab, a, b in spans:
            if lab == "ORG":
                a, b = _extend_org(toks, out, a, b)
            for j in range(a, b):
                out[j] = ("B-" if j == a else "I-") + lab
            stats[lab] += 1
        rows["tokens"].append(toks)
        rows["ner_tags"].append([l2i[t] for t in out])
        rows["lang"].append("ru")
        rows["doc"].append(f"nerus/{doc}")
    return {"train": rows, "validation": None, "test": None, "stats": stats}
