#!/usr/bin/env python3
"""
embedding_pass.py
=================

Berechnet pro stiftungs_dna-Eintrag (und optional medium_dna) einen
semantischen Embedding-Vektor (768-dim) ueber Ollama nomic-embed-text.

Speichert die Vektoren in zwei Orten:

  1. Qdrant-Collection 'faas_stiftungen_dna' (vector search)
  2. Directus stiftungs_dna.embedding_vector (JSON-Feld, fuer Audit)

Eingabe-Text fuer das Embedding ist die Konkatenation:
  - sound_feeling
  - tags + Begruendungen
  - Webseite-Inhalt (gekuerzt, falls in quellen.webseite_url - hier nur Snippets aus DDG)
  - DDG Web-Snippets (titles + bodies)

Aufruf:
  python3 embedding_pass.py --collection stiftungs_dna   # alle aktiven
  python3 embedding_pass.py --collection medium_dna       # alle aktiven
  python3 embedding_pass.py --stiftung-id 5680            # einzelne
  python3 embedding_pass.py --collection stiftungs_dna --only-missing  # nur die ohne Embedding

Voraussetzungen:
  - Ollama mit nomic-embed-text:latest
  - Qdrant auf localhost:6333 (Container 'qdrant')
  - DIRECTUS_URL, DIRECTUS_TOKEN in env

Autor: 3. Mai 2026, im Auftrag von Jolanda Spiess.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from typing import Optional

import requests

# ----------------------------------------------------------------------
# Konfiguration
# ----------------------------------------------------------------------

DIRECTUS_URL = os.environ["DIRECTUS_URL"]
DIRECTUS_TOKEN = os.environ["DIRECTUS_TOKEN"]
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
EMBED_MODEL = os.environ.get("FAAS_EMBED_MODEL", "nomic-embed-text:latest")
QDRANT_URL = os.environ.get("QDRANT_URL", "http://127.0.0.1:6333")

USER_AGENT = "FaaS-EmbeddingPass/v1 (jolanda@wepublish.ch)"
HTTP_TIMEOUT = 30
EMBED_TIMEOUT = 60

# Qdrant Collection-Namen
QDRANT_STIFTUNGS_COLL = "faas_stiftungen_dna"
QDRANT_MEDIEN_COLL = "faas_medien_dna"


def setup_logger() -> logging.Logger:
    log = logging.getLogger("embed_pass")
    log.setLevel(logging.INFO)
    if log.handlers:
        return log
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
    sh = logging.StreamHandler(sys.stderr)
    sh.setFormatter(fmt)
    log.addHandler(sh)
    return log


def directus_get(path: str, params: dict = None) -> dict:
    r = requests.get(
        f"{DIRECTUS_URL}{path}",
        headers={"Authorization": f"Bearer {DIRECTUS_TOKEN}", "User-Agent": USER_AGENT},
        params=params or {},
        timeout=HTTP_TIMEOUT,
    )
    r.raise_for_status()
    return r.json()


def directus_patch(path: str, body: dict) -> dict:
    r = requests.patch(
        f"{DIRECTUS_URL}{path}",
        headers={
            "Authorization": f"Bearer {DIRECTUS_TOKEN}",
            "User-Agent": USER_AGENT,
            "Content-Type": "application/json",
        },
        json=body,
        timeout=HTTP_TIMEOUT,
    )
    r.raise_for_status()
    return r.json()


def qdrant_ensure_collection(coll_name: str, log: logging.Logger):
    """Legt Qdrant-Collection an, falls nicht vorhanden. 768-dim, Cosine-Distance."""
    r = requests.get(f"{QDRANT_URL}/collections/{coll_name}", timeout=HTTP_TIMEOUT)
    if r.status_code == 200:
        log.info(f"Qdrant: Collection '{coll_name}' existiert")
        return
    log.info(f"Qdrant: Collection '{coll_name}' wird angelegt")
    r = requests.put(
        f"{QDRANT_URL}/collections/{coll_name}",
        json={"vectors": {"size": 768, "distance": "Cosine"}},
        timeout=HTTP_TIMEOUT,
    )
    r.raise_for_status()


def build_embed_text(dna: dict) -> str:
    """Konstruiert den Text-Input fuers Embedding aus einer DNA-Zeile."""
    parts = []
    if dna.get("stiftung_name") or dna.get("medium_name"):
        parts.append(f"# {dna.get('stiftung_name') or dna.get('medium_name')}")
    if dna.get("sound_feeling"):
        parts.append(f"\n## Sound-Feeling\n{dna['sound_feeling']}")
    tags = dna.get("tags") or []
    if tags:
        tag_lines = []
        for t in tags:
            slug = t.get("tag_slug", "?")
            gewicht = t.get("gewicht", 0)
            beg = (t.get("begruendung") or "")[:200]
            tag_lines.append(f"- [{gewicht}] {slug}: {beg}")
        parts.append("\n## Tags\n" + "\n".join(tag_lines))
    if dna.get("foerderpraxis"):
        parts.append(f"\n## Foerderpraxis\n{json.dumps(dna['foerderpraxis'], ensure_ascii=False)}")
    quellen = dna.get("quellen") or {}
    snippets = quellen.get("web_snippets") or []
    if snippets:
        snip_lines = []
        for s in snippets[:8]:  # max 8 Snippets
            t = s.get("title", "")
            sn = s.get("snippet", "")
            snip_lines.append(f"- {t}: {sn}")
        parts.append("\n## Web-Snippets (externer Kontext)\n" + "\n".join(snip_lines))
    text = "\n".join(parts)
    if len(text) > 7500:
        text = text[:7500] + "\n[...gekuerzt...]"
    return text


def call_embed(text: str, log: logging.Logger) -> Optional[list[float]]:
    """Ruft Ollama /api/embed mit nomic-embed-text auf."""
    if not text or len(text) < 50:
        return None
    try:
        r = requests.post(
            f"{OLLAMA_URL}/api/embed",
            json={"model": EMBED_MODEL, "input": text},
            timeout=EMBED_TIMEOUT,
        )
        r.raise_for_status()
        data = r.json()
        embeddings = data.get("embeddings") or [data.get("embedding")]
        if embeddings and embeddings[0]:
            return embeddings[0]
    except Exception as e:
        log.warning(f"Embedding-Call fehlgeschlagen: {e}")
    return None


def qdrant_upsert(coll_name: str, point_id: str, vector: list[float], payload: dict, log: logging.Logger):
    r = requests.put(
        f"{QDRANT_URL}/collections/{coll_name}/points",
        json={"points": [{"id": point_id, "vector": vector, "payload": payload}]},
        timeout=HTTP_TIMEOUT,
    )
    if r.status_code != 200:
        # Qdrant akzeptiert nur Integer- oder UUID-IDs. Hash falls noetig.
        import hashlib, uuid
        new_id = str(uuid.UUID(hashlib.md5(point_id.encode()).hexdigest()))
        r = requests.put(
            f"{QDRANT_URL}/collections/{coll_name}/points",
            json={"points": [{"id": new_id, "vector": vector, "payload": {**payload, "directus_id": point_id}}]},
            timeout=HTTP_TIMEOUT,
        )
    r.raise_for_status()


def process_stiftung_dna(dna: dict, log: logging.Logger) -> bool:
    """Berechnet Embedding fuer eine stiftungs_dna-Zeile und schreibt nach Qdrant + Directus."""
    text = build_embed_text(dna)
    if len(text) < 100:
        log.warning(f"  Stiftung {dna.get('stiftung_id')}: Embedding-Text zu kurz ({len(text)})")
        return False

    vector = call_embed(text, log)
    if not vector:
        return False

    point_id = str(dna["id"])
    payload = {
        "stiftung_id": dna.get("stiftung_id"),
        "stiftung_name": dna.get("stiftung_name"),
        "version_id": dna.get("version_id"),
        "schaerfe_prozent": dna.get("schaerfe_prozent"),
        "datenbasis": (dna.get("quellen") or {}).get("datenbasis"),
        "tag_slugs": [t.get("tag_slug") for t in (dna.get("tags") or [])],
    }
    qdrant_upsert(QDRANT_STIFTUNGS_COLL, point_id, vector, payload, log)

    # Plus: in Directus ein Marker-Feld setzen, dass Embedding existiert
    directus_patch(f"/items/stiftungs_dna/{point_id}", {
        "embedding": vector,
        "quellen": {
            **(dna.get("quellen") or {}),
            "embedding_at": datetime.now(timezone.utc).isoformat(),
            "embedding_dim": len(vector),
            "embedding_collection": QDRANT_STIFTUNGS_COLL,
        }
    })
    log.info(f"  OK: {dna.get('stiftung_name')} (vector dim={len(vector)})")
    return True


def process_medium_dna(dna: dict, log: logging.Logger) -> bool:
    """Analog fuer medium_dna."""
    text = build_embed_text(dna)
    if len(text) < 100:
        return False
    vector = call_embed(text, log)
    if not vector:
        return False
    point_id = str(dna["id"])
    payload = {
        "medium_id": dna.get("medium_id"),
        "medium_name": dna.get("medium_name"),
        "version_id": dna.get("version_id"),
        "schaerfe_prozent": dna.get("schaerfe_prozent"),
        "tag_slugs": [t.get("tag_slug") for t in (dna.get("tags") or [])],
    }
    qdrant_upsert(QDRANT_MEDIEN_COLL, point_id, vector, payload, log)
    directus_patch(f"/items/medium_dna/{point_id}", {
        "embedding": vector,
        "quellen": {
            **(dna.get("quellen") or {}),
            "embedding_at": datetime.now(timezone.utc).isoformat(),
            "embedding_dim": len(vector),
            "embedding_collection": QDRANT_MEDIEN_COLL,
        }
    })
    log.info(f"  OK: {dna.get('medium_name')} (vector dim={len(vector)})")
    return True


def run_collection(coll: str, only_missing: bool, log: logging.Logger) -> dict:
    if coll == "stiftungs_dna":
        qdrant_ensure_collection(QDRANT_STIFTUNGS_COLL, log)
    elif coll == "medium_dna":
        qdrant_ensure_collection(QDRANT_MEDIEN_COLL, log)
    else:
        raise ValueError(f"Unbekannte Collection: {coll}")

    # Aktive Eintraege laden
    fields = "id,version_id,sound_feeling,tags,foerderpraxis,quellen,schaerfe_prozent,"
    fields += "stiftung_id,stiftung_name" if coll == "stiftungs_dna" else "medium_id,medium_name"
    items = directus_get(f"/items/{coll}", {
        "filter[is_active][_eq]": "true",
        "limit": "-1",
        "fields": fields,
    }).get("data", [])
    log.info(f"{len(items)} aktive {coll}-Eintraege gefunden")

    stats = {"total": 0, "ok": 0, "skipped": 0, "failed": 0}
    for d in items:
        stats["total"] += 1
        if only_missing and (d.get("quellen") or {}).get("embedding_at"):
            stats["skipped"] += 1
            continue
        ok = (process_stiftung_dna if coll == "stiftungs_dna" else process_medium_dna)(d, log)
        if ok:
            stats["ok"] += 1
        else:
            stats["failed"] += 1
    return stats


def main():
    p = argparse.ArgumentParser()
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--collection", choices=["stiftungs_dna", "medium_dna"])
    g.add_argument("--stiftung-id", type=int)
    g.add_argument("--medium-id", type=str)
    p.add_argument("--only-missing", action="store_true", help="nur Eintraege ohne embedding_at")
    args = p.parse_args()
    log = setup_logger()

    if args.collection:
        stats = run_collection(args.collection, args.only_missing, log)
        print(json.dumps(stats, ensure_ascii=False))
    elif args.stiftung_id:
        qdrant_ensure_collection(QDRANT_STIFTUNGS_COLL, log)
        items = directus_get("/items/stiftungs_dna", {
            "filter[stiftung_id][_eq]": args.stiftung_id,
            "filter[is_active][_eq]": "true",
            "limit": "1",
        }).get("data", [])
        if not items:
            print(json.dumps({"ok": False, "reason": "keine aktive DNA"}))
            return
        ok = process_stiftung_dna(items[0], log)
        print(json.dumps({"ok": ok, "stiftung_id": args.stiftung_id}))
    elif args.medium_id:
        qdrant_ensure_collection(QDRANT_MEDIEN_COLL, log)
        items = directus_get("/items/medium_dna", {
            "filter[medium_id][_eq]": args.medium_id,
            "filter[is_active][_eq]": "true",
            "limit": "1",
        }).get("data", [])
        if not items:
            print(json.dumps({"ok": False, "reason": "keine aktive DNA"}))
            return
        ok = process_medium_dna(items[0], log)
        print(json.dumps({"ok": ok, "medium_id": args.medium_id}))


if __name__ == "__main__":
    main()
