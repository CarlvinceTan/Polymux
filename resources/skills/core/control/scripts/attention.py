"""Session-scoped attention; absence requires positive, fresh session evidence."""
import time


def apply_sessions(value):
    """Keep focus separate from presence. Idle time alone never means absent."""
    sessions = value.get('sessions', [])
    known = {}
    for session in sessions:
        ident = session.get('session_id')
        if ident in known:
            known[ident] = None  # Ambiguous session identity cannot prove absence.
        elif ident:
            known[ident] = session
    for surface in value.get('surfaces', []):
        session = known.get(surface.get('session_id'))
        if session and session.get('presence') == 'absent':
            surface['human_active'] = False
        elif surface.get('session_id') and not session:
            surface['human_active'] = 'unknown'
    complete = value.get('session_inventory_complete') is True
    if any(s.get('presence') == 'possible' for s in sessions):
        value['human_active'] = True
    elif complete and all(s.get('presence') == 'absent' for s in sessions):
        value['human_active'] = False
    else:
        value['human_active'] = 'unknown'
    return value


def browser_attention(value, pid):
    """Resolve the browser's destination session, never the collector's foreground."""
    stamp = value.get('observed_at')
    if not isinstance(stamp, (int, float)) or not 0 <= time.time() - stamp < 5:
        return 'unknown'
    rows = [s for s in value.get('surfaces', []) if s.get('pid') == pid and s.get('kind') == 'window']
    if not rows:
        return 'unknown'
    if any(s.get('human_active') is True for s in rows):
        return True
    return False if all(s.get('human_active') is False for s in rows) else 'unknown'
