"""Run k6 only against fresh loopback servers and temporary isolated SQLite databases."""
import os
import json
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]

def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]

def ready(url, process):
    for _ in range(150):
        try:
            with urllib.request.urlopen(url + '/api/health', timeout=1) as response:
                if response.status == 200:
                    return
        except OSError:
            if process.poll() is not None:
                raise RuntimeError(f'Server exited: {url}')
            time.sleep(.1)
    raise RuntimeError(f'Server did not start: {url}')

def main():
    k6 = os.environ.get('K6_BIN') or shutil.which('k6')
    if not k6:
        raise SystemExit('Install Grafana k6 or set K6_BIN to its executable')
    if not (ROOT / 'dist/server/index.js').exists() or not (ROOT / 'web-dist/index.html').exists():
        raise SystemExit('Run npm run build and npm run web:build first')
    results = ROOT / 'outputs' / 'k6'
    results.mkdir(parents=True, exist_ok=True)
    flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    with tempfile.TemporaryDirectory(prefix='business-suite-k6-') as temporary:
        temp = Path(temporary)
        binary = temp / ('station.exe' if os.name == 'nt' else 'station')
        subprocess.run(['go', 'build', '-o', str(binary), '.'], cwd=ROOT / 'backend', check=True)
        go_port, node_port = port(), port()
        go_url, node_url = f'http://127.0.0.1:{go_port}', f'http://127.0.0.1:{node_port}'
        go_env = {**os.environ, 'SUITE_ADDR': f'127.0.0.1:{go_port}', 'SUITE_DB': str(temp / 'station.sqlite'), 'SUITE_WEB': str(ROOT / 'web-dist')}
        node_env = {**os.environ, 'HOST': '127.0.0.1', 'PORT': str(node_port), 'SUITE_SQLITE_PATH': str(temp / 'business.sqlite')}
        processes = []
        try:
            for command, env in [([str(binary)], go_env), (['node', 'scripts/serve-linux.mjs'], node_env)]:
                processes.append(subprocess.Popen(command, cwd=ROOT, env=env, creationflags=flags))
            ready(go_url, processes[0]); ready(node_url, processes[1])
            for script, url in [('traffic-lab.js', go_url), ('station-business-race.js', go_url), ('business-race.js', node_url)]:
                for site in ['shop', 'mes']:
                    output = results / f'{script[:-3]}-{site}.json'
                    raw_output = temp / f'{script[:-3]}-{site}-raw.json'
                    env = {**os.environ, 'BASE_URL': url, 'SITE': site}
                    print(f'Running {script}: {site}', flush=True)
                    subprocess.run([k6, 'run', '--summary-export', str(raw_output), str(ROOT / 'load-tests' / script)], cwd=ROOT, env=env, check=True)
                    summary = json.loads(raw_output.read_text(encoding='utf-8'))
                    summary.pop('setup_data', None)  # k6 setup contains an authenticated session cookie.
                    summary['suite_scenario'] = {'site': site, 'kind': script[:-3], 'scope': 'isolated-loopback', 'k6_version': '2.3.0'}
                    output.write_text(json.dumps(summary, indent=2), encoding='utf-8')
        finally:
            for process in processes:
                process.terminate()
            for process in processes:
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait()
    print(f'Isolated k6 summaries: {results}')

if __name__ == '__main__':
    main()
