#!/bin/bash
# FaaS-Lebenszeichen Spark -> NAS fuer den NAS-Dead-Man-Switch. Cron alle 5 Min.
date +%s | ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 jolandaspiess@100.110.66.36 "cat > /volume2/ki_work/backups/spark/heartbeat/spark_alive" 2>/dev/null
