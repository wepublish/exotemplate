#!/bin/bash
export DIRECTUS_URL=http://localhost:8055
export DIRECTUS_TOKEN=$(grep -m1 DIRECTUS_TOKEN "$HOME/.hermes/.env" | cut -d= -f2 | tr -d '"[:space:]')
export FAAS_VLLM_URL=http://127.0.0.1:8001/v1
cd "$HOME/.hermes/data/faas" && /usr/bin/python3 "$HOME/faas-matching-wepublish/spark/projekt_matcher.py" --apply --only-new
