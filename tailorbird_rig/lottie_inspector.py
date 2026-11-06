"""Conservative authoring checks, not a full Lottie schema or renderer validator."""
import argparse
import json
import math
from pathlib import Path


def inspect(data):
    errors, warnings = [], []
    stats = {'layers': 0, 'paths': 0, 'pathVertices': 0, 'animatedProperties': 0,
             'keyframes': 0, 'rasterAssets': 0}
    for field in ('w', 'h', 'fr'):
        value = data.get(field)
        if isinstance(value,bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            errors.append(f'{field}: expected positive finite number')
    if not isinstance(data.get('layers'), list):
        errors.append('layers: expected array')
    try:
        duration = (data['op'] - data['ip']) / data['fr']
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError()
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        errors.append('ip/op/fr: invalid duration'); duration = None

    def walk(value, path='$'):
        if isinstance(value, float) and not math.isfinite(value):
            errors.append(f'{path}: nonfinite number')
        if isinstance(value, list):
            for n, child in enumerate(value):
                walk(child, f'{path}[{n}]')
        if not isinstance(value, dict):
            return
        if 'v' in value and all(k in value for k in ('i', 'o', 'c')):
            v, incoming, outgoing = value['v'], value['i'], value['o']
            if not all(isinstance(x, list) for x in (v, incoming, outgoing)) or not len(v) == len(incoming) == len(outgoing):
                errors.append(f'{path}: path/tangent lengths differ')
            else:
                stats['pathVertices'] += len(v)
        if value.get('ty') == 'sh':
            stats['paths'] += 1
            prop = value.get('ks', {})
            samples = [k['s'][0] for k in prop.get('k', []) if isinstance(k, dict) and k.get('s')] if prop.get('a') == 1 else [prop.get('k')]
            topology = {(len(s.get('v', [])), s.get('c')) for s in samples if isinstance(s, dict)}
            if len(topology) > 1:
                errors.append(f'{path}: morph path topology changes')
        if value.get('ty') == 'gr':
            items = value.get('it', [])
            if not items or items[-1].get('ty') != 'tr':
                warnings.append(f'{path}: end shape groups with an explicit transform for native renderer compatibility')
        if value.get('a') == 1 and isinstance(value.get('k'), list):
            stats['animatedProperties'] += 1
            keys = value['k']; stats['keyframes'] += len(keys)
            times = [k.get('t') for k in keys if isinstance(k, dict)]
            if len(times) != len(keys) or any(not isinstance(t, (int, float)) for t in times):
                errors.append(f'{path}: invalid keyframe times')
            elif any(b <= a for a, b in zip(times, times[1:])):
                errors.append(f'{path}: non-increasing keyframe times')
            if keys and sum(k.get('h') == 1 for k in keys if isinstance(k, dict)) > len(keys) / 2:
                warnings.append(f'{path}: mostly hold keys; check stepping is intentional')
        for key, child in value.items():
            if key == 'layers' and isinstance(child, list):
                stats['layers'] += len(child)
            walk(child, f'{path}.{key}')

    walk(data)
    for asset in data.get('assets', []):
        if 'p' in asset:
            stats['rasterAssets'] += 1
    return {'durationSeconds': duration, **stats, 'errors': errors, 'warnings': warnings}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('animation', type=Path)
    args = parser.parse_args()
    report = inspect(json.loads(args.animation.read_text(encoding='utf-8')))
    report['bytes'] = args.animation.stat().st_size
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(1 if report['errors'] else 0)
