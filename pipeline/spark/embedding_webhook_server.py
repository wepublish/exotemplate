#!/usr/bin/env python3
"""
embedding_webhook_server.py
===========================

Webhook-Receiver fuer Base44 runEmbeddingPass.

Hoert auf 127.0.0.1:8090, erwartet POST auf /webhook/embedding_pass
mit Authorization: Bearer <DIRECTUS_TOKEN> und Body:
  { "scope": "stiftungs_dna", "stiftung_id": 6705 }
  oder
  { "scope": "medium_dna", "medium_id": "cueltuer" }

Validiert Token gegen Directus /users/me (HTTP 200 = OK).
Triggert /home/dergeraet/scripts_v2/embedding_pass.py asynchron via subprocess.

Erstellt 12. Mai 2026 fuer FaaS-Welle-1.
"""

from __future__ import annotations
import http.server
import socketserver
import json
import logging
import os
import subprocess
import sys
import threading
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

HOST = "0.0.0.0"  # LAN-erreichbar, Auth via Directus-Token
PORT = 8090
DIRECTUS_URL = "http://127.0.0.1:8055"
EMBEDDING_SCRIPT = "/home/dergeraet/scripts_v2/embedding_pass.py"
LOG_PATH = "/home/dergeraet/logs/embedding_webhook.jsonl"
JOB_DIR = "/home/dergeraet/logs/embedding_webhook_jobs"

os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
os.makedirs(JOB_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("embedding_webhook")


def log_event(event: dict) -> None:
    event["ts"] = datetime.now(timezone.utc).isoformat()
    with open(LOG_PATH, "a") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")


def validate_token(token: str) -> tuple[bool, str | None]:
    """Validate token by calling Directus /users/me."""
    try:
        req = urllib.request.Request(
            f"{DIRECTUS_URL}/users/me?fields=id,email",
            headers={"Authorization": f"Bearer {token}"},
        )
        with urllib.request.urlopen(req, timeout=5) as r:
            if r.status == 200:
                data = json.loads(r.read()).get("data", {})
                return True, data.get("email")
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except Exception as e:
        return False, f"err {type(e).__name__}: {e}"
    return False, "unknown"


def run_embedding_job(scope: str, identifier: str | int, job_id: str) -> None:
    """Run embedding_pass.py asynchronously, capture output to job log."""
    job_log = os.path.join(JOB_DIR, f"{job_id}.log")
    try:
        if scope == "stiftungs_dna":
            cmd = ["/usr/bin/python3", EMBEDDING_SCRIPT, "--stiftung-id", str(identifier)]
        elif scope == "medium_dna":
            cmd = ["/usr/bin/python3", EMBEDDING_SCRIPT, "--medium-id", str(identifier)]
        else:
            log_event({"job_id": job_id, "event": "invalid_scope", "scope": scope})
            return

        log_event({"job_id": job_id, "event": "start", "cmd": cmd})
        env = os.environ.copy()
        env_file = "/home/dergeraet/.hermes/.env"
        if os.path.exists(env_file):
            with open(env_file) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        env[k.strip()] = v.strip().strip('"').strip("'")
        with open(job_log, "w") as out:
            proc = subprocess.run(
                cmd, stdout=out, stderr=subprocess.STDOUT, env=env, timeout=600
            )
        log_event(
            {
                "job_id": job_id,
                "event": "done",
                "rc": proc.returncode,
                "log": job_log,
            }
        )
    except subprocess.TimeoutExpired:
        log_event({"job_id": job_id, "event": "timeout"})
    except Exception as e:
        log_event({"job_id": job_id, "event": "exception", "err": str(e)})


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "EmbeddingWebhook/0.1"

    def log_message(self, fmt, *args):
        log.info("%s - %s", self.client_address[0], fmt % args)

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True, "service": "embedding_webhook", "ts": datetime.now(timezone.utc).isoformat()})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path not in ("/webhook/embedding_pass", "/webhook/embedding_pass/"):
            self._json(404, {"error": "not found"})
            return

        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            self._json(401, {"error": "missing bearer token"})
            return
        token = auth[len("Bearer "):].strip()

        ok, who = validate_token(token)
        if not ok:
            log_event({"event": "auth_failed", "remote": self.client_address[0], "reason": who})
            self._json(401, {"error": "invalid token", "reason": who})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            payload = json.loads(raw or b"{}")
        except Exception as e:
            self._json(400, {"error": f"bad json: {e}"})
            return

        scope = payload.get("scope")
        if scope == "stiftungs_dna":
            ident = payload.get("stiftung_id")
            if not isinstance(ident, int):
                self._json(400, {"error": "stiftung_id must be integer"})
                return
        elif scope == "medium_dna":
            ident = payload.get("medium_id")
            if not isinstance(ident, str) or not ident:
                self._json(400, {"error": "medium_id must be non-empty string"})
                return
        else:
            self._json(400, {"error": "scope must be stiftungs_dna or medium_dna"})
            return

        job_id = f"{scope}-{ident}-{int(time.time())}"
        log_event(
            {
                "event": "accepted",
                "job_id": job_id,
                "scope": scope,
                "ident": ident,
                "actor": payload.get("actor"),
                "remote": self.client_address[0],
                "user": who,
            }
        )
        t = threading.Thread(target=run_embedding_job, args=(scope, ident, job_id), daemon=True)
        t.start()
        self._json(202, {"accepted": True, "job_id": job_id, "scope": scope})


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    log.info(f"starting embedding_webhook on {HOST}:{PORT}")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("shutdown")


if __name__ == "__main__":
    main()
