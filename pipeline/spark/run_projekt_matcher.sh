#!/bin/bash
export DIRECTUS_URL=http://localhost:8055
export DIRECTUS_TOKEN=$(grep -m1 DIRECTUS_TOKEN "$HOME/.hermes/.env" | cut -d= -f2 | tr -d '"[:space:]')
export FAAS_VLLM_URL=http://127.0.0.1:8001/v1
# Mess-Modell HIER festlegen, nicht aus ~/.hermes/.env erben (Befund 29.07.2026):
# dort stand FAAS_DNA_MODEL=nemotron-3-super:120b-a12b, ein Modell, das weder
# vLLM noch Ollama (mehr) kennt -> jede Projekt-DNA-Messung brach mit HTTP 404
# ab, still, denn der Cron laeuft mit --only-new und meldet nur ins Log.
# qwen ist ausserdem die verbindliche Mess-Elle: der Matcher schreibt
# dna_quality_tier "qwen_v3" - mit einem anderen Modell waere das Label falsch.
export FAAS_DNA_MODEL=qwen3.6-27b
cd "$HOME/.hermes/data/faas" && /usr/bin/python3 "$HOME/faas-matching-wepublish/spark/projekt_matcher.py" --apply --only-new
