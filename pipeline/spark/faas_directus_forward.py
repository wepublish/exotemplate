#!/usr/bin/env python3
# FaaS Interim-Schreibpfad (B9): leitet 127.0.0.1:8055 auf dem Spark ueber
# Tailscale an die Hetzner-VPS-Directus (100.120.78.79:8055) weiter.
# Alle Pipeline-Schreiber, die auf localhost:8055 zielen, treffen so transparent
# die VPS. Reiner TCP-Proxy, keine TLS-Terminierung (Directus spricht HTTP).
# Wird beim Abschluss des Python-Ports auf TS ueberfluessig.
import socket
import threading

LISTEN = ("127.0.0.1", 8055)
TARGET = ("100.120.78.79", 8055)


def _pipe(src, dst):
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except OSError:
        pass
    finally:
        for s in (src, dst):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


def _handle(client):
    try:
        upstream = socket.create_connection(TARGET, timeout=10)
    except OSError:
        client.close()
        return
    threading.Thread(target=_pipe, args=(client, upstream), daemon=True).start()
    threading.Thread(target=_pipe, args=(upstream, client), daemon=True).start()


def main():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(LISTEN)
    srv.listen(128)
    while True:
        client, _ = srv.accept()
        _handle(client)


if __name__ == "__main__":
    main()
