"""Package a verified build and its IaC without credentials or runtime data."""
import hashlib
import json
from pathlib import Path
import tarfile
import subprocess

items = ['dist', 'web-dist', 'backend', 'infra', 'scripts/infra.mjs', 'scripts/serve-linux.mjs', 'scripts/station-routing.mjs', 'scripts/smoke-http.mjs', 'scripts/smoke-infrastructure-web.mjs', 'scripts/smoke-platform-control.mjs', 'scripts/smoke-mes-projection-web.mjs', 'scripts/verify-control-graph.py', 'scripts/verify-navigation-build.mjs', 'lib/db/sqlite-d1.ts', 'drizzle']
if not Path('web-dist/index.html').is_file():
    raise SystemExit('Run npm run web:build before packaging')
if not Path('dist/server/index.js').is_file():
    raise SystemExit('Run npm run build before packaging')
subprocess.run(['node','scripts/verify-navigation-build.mjs'],check=True)

def clean(info):
    for part in Path(info.name).parts:
        if part in ('.data', '__pycache__') or part.endswith('.pyc'):
            return None
        if part.startswith(('.env', '.dev.vars')) and part != '.env.example':
            return None
    if info.issym() or info.islnk():
        return None
    return info

target = Path('outputs/linux-business-suite.tgz')
items.append('scripts/check-station-revision.py')
items.append('scripts/smoke-station-isolation.mjs')
items.append('scripts/load-commerce.mjs')
items.append('scripts/smoke-public-edge.py')
target.parent.mkdir(exist_ok=True)
with tarfile.open(target, 'w:gz') as archive:
    for item in items:
        archive.add(item, filter=clean)
receipt = {'archive': str(target), 'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}
target.with_suffix('.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
print(json.dumps(receipt))
