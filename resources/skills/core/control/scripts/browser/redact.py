"""Remove credential-like URL components from ambient metadata, including nested providers."""
import re
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

SENSITIVE = re.compile(r'(?:^|[_-])(?:code|token|secret|password|passwd|key|signature|session|credential|state|auth)(?:$|[_-])', re.I)


def url(value):
    if not isinstance(value, str):
        return value
    try:
        parts = urlsplit(value)
        if parts.scheme not in {'http','https'}:
            return value if parts.scheme in {'about','chrome','edge','moz-extension','chrome-extension',''} else parts.scheme+':[redacted]'
        netloc = parts.netloc.rsplit('@',1)[-1]
        query = urlencode([(key, '[redacted]' if SENSITIVE.search(key) else val)
                           for key,val in parse_qsl(parts.query, keep_blank_values=True)])
        fragment = '[redacted]' if parts.fragment else ''
        return urlunsplit((parts.scheme, netloc, parts.path, query, fragment))
    except ValueError:
        return '[unavailable URL]'


def ambient(value):
    if isinstance(value, dict):
        return {k: url(v) if k in {'url','URL'} else ambient(v) for k,v in value.items()}
    if isinstance(value, list):
        return [ambient(v) for v in value]
    return value
