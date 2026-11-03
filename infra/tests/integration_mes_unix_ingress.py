"""Linux CI integration for systemd-socket-proxyd and Caddy read-only socket mount."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import uuid


def run(args, *, check=True, capture=False):
    result = subprocess.run([str(x) for x in args], check=check, text=True, capture_output=capture)
    return result.stdout if capture else result


class HealthServer:
    def __init__(self, port, body):
        from http.server import BaseHTTPRequestHandler, HTTPServer
        payload = json.dumps(body).encode()
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path != '/api/health':
                    self.send_error(404); return
                self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(payload)
            def log_message(self, *_args): pass
        self.server = HTTPServer(('127.0.0.1', port), Handler)
        import threading
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
    def close(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(timeout=3)


def request(port, *, succeeds):
    result = run(['curl', '--silent', '--show-error', '--fail', '--insecure', '--max-time', '3', '--resolve', f'mes.localhost:{port}:127.0.0.1', f'https://mes.localhost:{port}/api/health'], check=False, capture=True)
    if succeeds:
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or 'Caddy request failed')
        value = json.loads(result.stdout)
        if value.get('data', {}).get('backend') != 'go' or value.get('data', {}).get('status') != 'ready':
            raise RuntimeError(f'unexpected health response: {value!r}')
    elif result.returncode == 0:
        raise RuntimeError('MES route unexpectedly succeeded while TCP upstream was down')


def main():
    for tool in ('docker', 'curl', 'sudo', 'systemd-socket-activate', 'systemd-socket-proxyd'):
        if not shutil.which(tool):
            raise SystemExit(f'Missing integration dependency: {tool}')
    suffix = f'{os.environ.get("GITHUB_RUN_ID", "ci")}-{uuid.uuid4().hex[:8]}'
    project = f'mes-unix-ci-{suffix}'
    probe = socket.socket(); probe.bind(('127.0.0.1', 0)); upstream_port = probe.getsockname()[1]; probe.close()
    probe = socket.socket(); probe.bind(('127.0.0.1', 0)); caddy_port = probe.getsockname()[1]; probe.close()
    base = Path(tempfile.mkdtemp(prefix='mes-unix-ci-'))
    socket_dir = base / 'mes-ingress'; socket_dir.mkdir(mode=0o755)
    sock = socket_dir / 'upstream.sock'
    caddyfile = base / 'Caddyfile'
    caddyfile.write_text('''{\n local_certs\n}\nmes.localhost {\n reverse_proxy unix//run/mes-ingress/upstream.sock\n}\n''')
    compose = base / 'compose.yaml'
    compose.write_text(f'''services:\n  edge:\n    image: caddy:2.10-alpine\n    ports: ["127.0.0.1:{caddy_port}:443"]\n    volumes:\n      - {caddyfile}:/etc/caddy/Caddyfile:ro\n      - {socket_dir}:/run/mes-ingress:ro\n      - {base}/data:/data\n      - {base}/config:/config\n''')
    server = None; proxy = None; caddy_up = False
    try:
        run(['sudo', 'chown', 'root:root', socket_dir]); run(['sudo', 'chmod', '0755', socket_dir])
        server = HealthServer(upstream_port, {'success': True, 'data': {'backend': 'go', 'status': 'ready'}})
        proxy = subprocess.Popen(['sudo', 'systemd-socket-activate', '--listen', str(sock), '--accept=no', 'systemd-socket-proxyd', f'127.0.0.1:{upstream_port}'], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        for _ in range(10):
            if sock.exists(): break
            if proxy.poll() is not None: raise RuntimeError(proxy.stderr.read())
            time.sleep(.2)
        if not sock.exists(): raise RuntimeError('socket activation did not create the ingress socket')
        run(['sudo', 'chown', 'root:root', sock]); run(['sudo', 'chmod', '0600', sock])
        run(['docker', 'compose', '-p', project, '-f', compose, 'up', '-d', '--wait', '--wait-timeout', '90'])
        caddy_up = True
        request(caddy_port, succeeds=True)
        server.close(); server = None
        request(caddy_port, succeeds=False)
        server = HealthServer(upstream_port, {'success': True, 'data': {'backend': 'go', 'status': 'ready'}})
        request(caddy_port, succeeds=True)
        # Prove the container's socket-directory mount is read-only.
        result = run(['docker', 'exec', f'{project}-edge-1', 'sh', '-c', 'touch /run/mes-ingress/forbidden'], check=False)
        if result.returncode == 0: raise RuntimeError('Caddy socket mount unexpectedly permits writes')
        print('PASS: systemd socket proxy forwarded Go health; TCP outage and recovery propagated; Caddy socket mount is read-only.')
    finally:
        if caddy_up: run(['docker', 'compose', '-p', project, '-f', compose, 'down', '--volumes', '--remove-orphans'], check=False)
        if proxy and proxy.poll() is None: proxy.terminate(); proxy.wait(timeout=5)
        if server: server.close()
        if sock.exists(): sock.unlink()
        subprocess.run(['sudo', 'chown', '-R', f'{os.getuid()}:{os.getgid()}', str(base)], check=False)
        shutil.rmtree(base, ignore_errors=True)


if __name__ == '__main__': main()
