#!/usr/bin/env python3
"""Assemble Tidewright.html from the section files without changing their order."""
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / 'Tidewright.rebuilt.html'
template = (HERE / 'template.html').read_text()
parts = []
paths = list((HERE / 'src').glob('*.js'))
def module_key(path):
    # TW is created by 00-core; settings must load immediately after it.
    if path.name == '00-core.js': return (0, path.name)
    if path.name == 'game-settings.js': return (1, path.name)
    return (2, path.name)
for path in sorted(paths, key=module_key):
    parts.append(path.read_text())
script = ''.join(parts)
if '__TIDEWRIGHT_SOURCE_SCRIPT__' not in template:
    raise SystemExit('Template token missing')
OUT.write_text(template.replace('__TIDEWRIGHT_SOURCE_SCRIPT__', script))
print(f'assembled {OUT} from {len(parts)} modules')
