#!/bin/bash
# Wartet, bis die kirchen-/foerderer-DNA-Laeufe fertig sind, misst dann die noch
# DNA-losen Sonder-Pools (lotteriefonds, sponsoren) und rechnet zum Schluss das
# Sonder-Matching ueber ALLE vier Pools neu (idempotent). Sequenziell, damit der
# single-stream Studio-MLX nicht thrasht.
while pgrep -f "[k]irchen_dna.py" >/dev/null || pgrep -f "[f]oerderer_dna.py" >/dev/null \
   || pgrep -f "[s]onder_dna.py" >/dev/null; do
  sleep 300
done

echo "=== lotteriefonds/sponsoren DNA messen $(date -Is) ==="
cd ~/dna_pilot || exit 1
python3 sonder_dna.py --collection lotteriefonds
python3 sonder_dna.py --collection sponsoren

echo "=== Sonder-Match ueber alle Pools $(date -Is) ==="
cd ~/faas-matching-wepublish/spark || exit 1
export DIRECTUS_URL=http://localhost:8055
export DIRECTUS_TOKEN=$(grep '^DIRECTUS_TOKEN=' ~/.hermes/.env | head -1 | cut -d= -f2- | tr -d '"'"'"'')
python3 sonder_matcher.py --apply
