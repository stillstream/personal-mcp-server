#!/usr/bin/env python3
import argparse
from http.server import BaseHTTPRequestHandler, HTTPServer

parser = argparse.ArgumentParser()
parser.add_argument('command')
parser.add_argument('--control-plane.tunnel-id')
parser.add_argument('--control-plane.api-key')
parser.add_argument('--mcp.server-url')
parser.add_argument('--health.listen-addr')
args = parser.parse_args()
host, port = getattr(args, 'health.listen_addr').rsplit(':', 1)

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ('/readyz', '/healthz'):
            body = b'ready' if self.path == '/readyz' else b'live'
            self.send_response(200)
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()
    def log_message(self, *_):
        pass

HTTPServer((host, int(port)), Handler).serve_forever()
