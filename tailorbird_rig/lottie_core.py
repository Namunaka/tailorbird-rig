"""Small standard-library helpers for programmatically authored Lottie shapes."""
import json
from pathlib import Path


def fixed(value):
    return {'a': 0, 'k': value}


def animated(samples, ease=None):
    """samples: ordered (frame_number, value) pairs; values keep their Lottie type."""
    easing = ease or ({'x': 1, 'y': 1}, {'x': 0, 'y': 0})
    keys = []
    for frame, value in samples:
        if keys and frame <= keys[-1]['t']:
            raise ValueError('Keyframe times must increase')
        keys.append({'t': frame, 's': value if isinstance(value, list) else [value],
                     'i': dict(easing[0]), 'o': dict(easing[1])})
    if not keys:
        raise ValueError('At least one keyframe is required')
    return {'a': 1, 'k': keys}


def transform(position=None, scale=None, rotation=0, opacity=100):
    return {'p': fixed(position or [0, 0, 0]), 'a': fixed([0, 0, 0]),
            's': fixed(scale or [100, 100, 100]), 'r': fixed(rotation), 'o': fixed(opacity)}


def bezier(points, closed=False, tension=1):
    """Catmull-style smooth handles; not an arc-length or material-point tracker."""
    v = [[round(float(x), 3), round(float(y), 3)] for x, y in points]
    if len(v) < 2:
        raise ValueError('A path needs at least two vertices')
    incoming, outgoing = [], []
    for n, point in enumerate(v):
        before = v[(n - 1) % len(v)] if closed or n else point
        after = v[(n + 1) % len(v)] if closed or n < len(v) - 1 else point
        tangent = [(after[a] - before[a]) * tension / 6 for a in (0, 1)]
        incoming.append([round(-x, 3) for x in tangent])
        outgoing.append([round(x, 3) for x in tangent])
    return {'v': v, 'i': incoming, 'o': outgoing, 'c': closed}


def shape_layer(name, index, shapes, end_frame, start_frame=0):
    return {'ddd': 0, 'ind': index, 'ty': 4, 'nm': name, 'sr': 1, 'ks': transform(),
            'ao': 0, 'ip': start_frame, 'op': end_frame, 'st': 0, 'bm': 0, 'shapes': shapes}


def animation(name, width, height, fps, duration, layers):
    if min(width, height, fps, duration) <= 0:
        raise ValueError('Dimensions, frame rate and duration must be positive')
    return {'v': '5.12.2', 'nm': name, 'fr': fps, 'ip': 0, 'op': fps * duration,
            'w': width, 'h': height, 'ddd': 0, 'assets': [], 'layers': layers}


def write(data, destination):
    Path(destination).write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'),
                                           allow_nan=False) + '\n', encoding='utf-8')
