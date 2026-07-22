#!/usr/bin/env python3
"""Vor-Klassifikator (Spark, vLLM). Bestimmt fuer unklassifizierte Stiftungen
ist_foerderstiftung (Ja/Nein, im Zweifel JA) mit qwen3.6 ueber vLLM (:8001,
bereits geladenes Modell -> kein zweiter Modell-Load, kein OOM neben web_enrich)
und schreibt es nach Directus. Leicht, parallel, resumierbar.

Aufruf (Spark):
  DIRECTUS_URL=http://localhost:8055 python3 classify_runner.py --land LI --workers 3 --run-id classify_li
"""
import json, argparse, os, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.environ.get("DIRECTUS_URL", "http://localhost:8055")
TOK = open(os.path.join(HERE, ".dtoken")).read().strip()
LLM_URL = os.environ.get("LLM_URL", "http://127.0.0.1:8001/v1")
MODEL = os.environ.get("LLM_MODEL", "qwen3.6-27b")

SYSTEM = """detailed thinking off
Du entscheidest, ob eine Organisation eine FOERDERSTIFTUNG ist: eine Stiftung/Organisation, die Dritte (Projekte, Organisationen, Personen) finanziell unterstuetzt (Beitraege, Stipendien, Foerderungen vergibt). NICHT-Foerderstiftungen sind z.B. Personalvorsorge-/Pensionskassen, reine Betriebsstiftungen (betreiben nur eigene Anlagen ohne Dritt-Foerderung), Holding-/Familienstiftungen ohne Vergabe. Im Zweifel JA (lieber zu viel als eine echte Foerderin verpassen). Antworte AUSSCHLIESSLICH mit JSON: {"ist_foerderstiftung": true|false, "begruendung": "<=120 Zeichen"}"""

def directus(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE+path, data=data, method=method)
    r.add_header("Authorization","Bearer "+TOK)
    if data: r.add_header("Content-Type","application/json")
    try:
        with urllib.request.urlopen(r, timeout=40) as resp:
            raw=resp.read().decode(); return resp.status,(json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8","replace")[:200]

def page(lands):
    out=[]
    for land in lands:
        off=0
        while True:
            st,d=directus("GET", f"/items/stiftungen?filter[ist_foerderstiftung][_null]=true&filter[land][_eq]={land}&limit=500&offset={off}&sort=id&fields=id,Stiftungsname,zwecktext,kategorie,foerderbedingungen")
            b=(d or {}).get("data",[]) if isinstance(d,dict) else []
            if not b: break
            out+=b; off+=500
            if len(b)<500: break
    return out

def llm(user):
    # vLLM (OpenAI-kompatibel): KEIN response_format (haengt qwen3.6), enable_thinking via chat_template_kwargs
    body={"model":MODEL,
          "messages":[{"role":"system","content":SYSTEM},{"role":"user","content":user}],
          "temperature":0,"max_tokens":300,
          "chat_template_kwargs":{"enable_thinking":False}}
    r=urllib.request.Request(LLM_URL+"/chat/completions", data=json.dumps(body).encode(), method="POST")
    r.add_header("Content-Type","application/json")
    with urllib.request.urlopen(r, timeout=300) as resp:
        d=json.loads(resp.read().decode())
        return d["choices"][0]["message"]["content"]

def parse(txt):
    if "</think>" in txt: txt=txt.split("</think>")[-1]
    try: return json.loads(txt.strip())
    except Exception:
        import re
        m=re.search(r'\{[^{}]*"ist_foerderstiftung"[^{}]*\}', txt)
        return json.loads(m.group(0)) if m else None

def classify_one(s):
    sid=s["id"]
    try:
        user=f"Name: {s.get('Stiftungsname')}\nKategorie: {s.get('kategorie') or '?'}\nZweck: {(s.get('zwecktext') or s.get('foerderbedingungen') or '(leer)')[:1500]}"
        res=None
        for _ in range(3):
            try:
                res=parse(llm(user))
                if res is not None and "ist_foerderstiftung" in res: break
            except Exception: time.sleep(2)
        if not res or "ist_foerderstiftung" not in res:
            return sid,{"ok":False,"stage":"no_json"}
        val=bool(res["ist_foerderstiftung"])
        st,_=directus("PATCH", f"/items/stiftungen/{sid}", {"ist_foerderstiftung": val})
        if st not in (200,204): return sid,{"ok":False,"stage":"patch","code":st}
        return sid,{"ok":True,"val":val}
    except Exception as e:
        return sid,{"ok":False,"stage":"exc","err":f"{type(e).__name__}"[:80]}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--land", default="LI"); ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--limit", type=int, default=0); ap.add_argument("--run-id", default="classify")
    a=ap.parse_args(); lands=a.land.split(",")
    manifest=os.path.join(HERE, f"manifest_{a.run_id}.json")
    done=set(json.load(open(manifest)).get("done",[])) if os.path.exists(manifest) else set()
    rows=[s for s in page(lands) if s["id"] not in done]
    if a.limit: rows=rows[:a.limit]
    print(f"[{a.run_id}] {len(rows)} unklassifiziert ({len(done)} done), land={lands}, workers={a.workers}, llm={MODEL}", flush=True)
    ok=fail=yes=0; t0=time.time()
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        futs={ex.submit(classify_one,s):s["id"] for s in rows}
        for i,f in enumerate(as_completed(futs),1):
            sid,res=f.result()
            if res.get("ok"):
                ok+=1; done.add(sid); yes+=1 if res["val"] else 0
                if i%50==0 or i<5: print(f"  [{i}/{len(rows)}] ok (foerder bisher={yes})", flush=True)
            else:
                fail+=1
                if fail<=20: print(f"  [{i}/{len(rows)}] {sid} FAIL {res.get('stage')} {res.get('code','')}", flush=True)
            if i%50==0: json.dump({"done":sorted(done)}, open(manifest,"w"))
    json.dump({"done":sorted(done)}, open(manifest,"w"))
    dt=time.time()-t0
    print(f"[{a.run_id}] FERTIG: ok={ok} (davon foerder={yes}) fail={fail} in {dt/60:.1f} min. Manifest: {manifest}", flush=True)

if __name__=="__main__":
    main()
