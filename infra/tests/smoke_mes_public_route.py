"""Remote CI test of central Caddy routing across separate Compose networks."""

import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
INFRA = ROOT / 'infra'
LINUX = INFRA / 'linux'
sys.path.insert(0, str(LINUX))
from mes_public_route import validate_go_health  # noqa: E402

SHARED_SERVER = '''
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
body = json.dumps({"success": True, "data": {"backend": "shared", "status": "ready"}}).encode()
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/api/health":
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *_args):
        pass
HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
'''.strip()

MES_SERVER = SHARED_SERVER.replace('"shared"', '"go"').replace('8080', '8095')


def run(args, *, env=None, capture=False):
    result = subprocess.run(
        [str(item) for item in args],
        cwd=ROOT,
        env=env,
        check=True,
        text=True,
        capture_output=capture,
    )
    return result.stdout if capture else ''


def free_port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


def fetch_health(port, host):
    result = subprocess.run(
        [
            'curl', '--silent', '--show-error', '--fail', '--insecure', '--max-time', '5',
            '--resolve', f'{host}:{port}:127.0.0.1',
            f'https://{host}:{port}/api/health',
        ],
        cwd=ROOT,
        text=False,
        capture_output=True,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.decode('utf-8', errors='replace').strip() or f'{host} health request failed')
    return result.stdout


def wait_health(port, host, expected_backend):
    last_error = None
    for _ in range(45):
        try:
            payload = fetch_health(port, host)
            value = json.loads(payload)
            if value.get('success') is not True or value.get('data', {}).get('backend') != expected_backend or value.get('data', {}).get('status') != 'ready':
                raise RuntimeError(f'{host} returned an unexpected health document: {value!r}')
            if expected_backend == 'go' and not validate_go_health(payload):
                raise RuntimeError('Isolated upstream did not match the Go health contract')
            return
        except Exception as error:
            last_error = error
            time.sleep(1)
    raise RuntimeError(f'{host} did not become healthy: {last_error}')


def main():
    required = ('docker', 'curl')
    missing = [tool for tool in required if shutil.which(tool) is None]
    if missing:
        raise SystemExit(f"Required remote CI tools are missing: {', '.join(missing)}")
    suffix = f'{os.environ.get("GITHUB_RUN_ID", "ci")}-{uuid.uuid4().hex[:8]}'
    project = f'mes-route-ci-{suffix}'
    central_network = f'mes-route-ci-central-{suffix}'
    mes_network = f'mes-route-ci-mes-{suffix}'
    station_container = f'mes-route-ci-station-{suffix}'
    if subprocess.run(['docker', 'network', 'inspect', mes_network], capture_output=True).returncode == 0:
        raise SystemExit(f'Refusing to reuse pre-existing network {mes_network}')
    if subprocess.run(['docker', 'network', 'inspect', central_network], capture_output=True).returncode == 0:
        raise SystemExit(f'Refusing to reuse pre-existing network {central_network}')
    if subprocess.run(['docker', 'ps', '-aq', '--filter', f'label=com.docker.compose.project={project}'], capture_output=True, text=True).stdout.strip():
        raise SystemExit(f'Refusing to reuse pre-existing Compose project {project}')
    http_port = free_port()
    https_port = free_port()
    while https_port == http_port:
        https_port = free_port()

    network_created = False
    central_network_created = False
    station_created = False
    compose_started = False
    temp_paths = []
    env_fd, env_name = tempfile.mkstemp(prefix='mes-route-ci-', suffix='.env')
    os.close(env_fd)
    env_file = Path(env_name)
    temp_paths.append(env_file)
    env_file.write_text('BASE_DOMAIN=localhost\n', encoding='utf-8')

    test_caddy = LINUX / f'.Caddyfile.sites-ci-{suffix}'
    source_caddy = (LINUX / 'Caddyfile.sites').read_text(encoding='utf-8')
    test_caddy.write_text('{' + '\n    local_certs\n}\n\n' + source_caddy, encoding='utf-8')
    temp_paths.append(test_caddy)

    source_compose = (LINUX / 'compose.public-sites.yaml').read_text(encoding='utf-8')
    port_line = 'ports: ["80:80", "443:443"]'
    if source_compose.count(port_line) != 1:
        raise SystemExit('Could not uniquely locate Caddy port mapping for the isolated CI fixture')
    test_compose = LINUX / f'.compose.public-sites-ci-{suffix}.yaml'
    test_compose.write_text(
        source_compose.replace(port_line, f'ports: ["127.0.0.1:{http_port}:80", "127.0.0.1:{https_port}:443"]')
        .replace('./linux/Caddyfile.sites:', f'./linux/{test_caddy.name}:', 1),
        encoding='utf-8',
    )
    temp_paths.append(test_compose)

    source_overlay = (LINUX / 'compose.mes-public-route.yaml').read_text(encoding='utf-8')
    network_line = 'name: business-suite-mes_default'
    if source_overlay.count(network_line) != 1:
        raise SystemExit('Could not uniquely locate isolated MES network name in the production overlay')
    test_overlay = LINUX / f'.compose.mes-public-route-ci-{suffix}.yaml'
    test_overlay.write_text(source_overlay.replace(network_line, f'name: {mes_network}', 1), encoding='utf-8')
    temp_paths.append(test_overlay)

    fixture = INFRA / f'.compose.mes-route-ci-{suffix}.yaml'
    fixture.write_text(
        'services:\n'
        '  web:\n'
        '    image: python:3.12-alpine\n'
        '    command:\n'
        '      - python\n'
        '      - -u\n'
        '      - -c\n'
        '      - |\n'
        + ''.join(f'        {line}\n' for line in SHARED_SERVER.splitlines())
        + '    healthcheck:\n'
        '      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen(\'http://127.0.0.1:8080/api/health\', timeout=2)"]\n'
        '      interval: 1s\n'
        '      timeout: 3s\n'
        '      retries: 30\n',
        encoding='utf-8',
    )
    temp_paths.append(fixture)
    environment = os.environ.copy()
    environment.update({'MES_PUBLIC_UPSTREAM': 'web:8080'})
    common = ['docker', 'compose', '--project-name', project, '--env-file', str(env_file), '-f', str(fixture), '-f', str(test_compose)]

    try:
        run(['docker', 'network', 'create', '--label', 'com.docker.compose.project=business-suite-mes', '--label', 'com.docker.compose.network=default', mes_network])
        network_created = True
        run(['docker', 'network', 'create', central_network])
        central_network_created = True
        run(['docker', 'run', '--detach', '--name', station_container, '--network', mes_network, '--network-alias', 'mes-station', '--env', 'PORT=8095', 'python:3.12-alpine', 'python', '-u', '-c', MES_SERVER])
        station_created = True

        compose_started = True
        run(common + ['up', '--detach', '--wait', '--wait-timeout', '180', 'edge'], env=environment)
        wait_health(https_port, 'mes.localhost', 'shared')
        wait_health(https_port, 'erp.localhost', 'shared')

        isolated = dict(environment, MES_PUBLIC_UPSTREAM='mes-station:8095')
        run(common + ['-f', str(test_overlay), 'up', '--detach', '--force-recreate', '--wait', '--wait-timeout', '180', 'edge'], env=isolated)
        wait_health(https_port, 'mes.localhost', 'go')
        wait_health(https_port, 'erp.localhost', 'shared')
        print('PASS: GitHub CI Caddy routed only MES across the isolated Docker network; other public stations stayed on web.')
    finally:
        if compose_started:
            subprocess.run(common + ['down', '--volumes', '--remove-orphans'], cwd=ROOT, capture_output=True, text=True)
        if station_created:
            subprocess.run(['docker', 'rm', '--force', station_container], capture_output=True, text=True)
        if central_network_created:
            subprocess.run(['docker', 'network', 'rm', central_network], capture_output=True, text=True)
        if network_created:
            subprocess.run(['docker', 'network', 'rm', mes_network], capture_output=True, text=True)
        for path in temp_paths:
            try:
                path.unlink()
            except FileNotFoundError:
                pass


if __name__ == '__main__':
    main()
