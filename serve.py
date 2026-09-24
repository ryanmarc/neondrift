#!/usr/bin/env python3
"""Serve the game for local development, with caching turned off.

`python3 -m http.server` sends no Cache-Control header, so Chrome keeps module
scripts under its heuristic freshness rule and a plain reload can run stale
code. This wrapper is the same server with `Cache-Control: no-store` on every
response, so a normal reload always fetches fresh files.

Usage: python3 serve.py [port]   (default 8000; binds all interfaces so a
phone on the same wifi can open http://<LAN IP>:<port>/index.html)
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = ThreadingHTTPServer(("0.0.0.0", port), NoCacheHandler)
    print(f"Serving on http://localhost:{port}/index.html (Cache-Control: no-store)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
