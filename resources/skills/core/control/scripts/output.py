"""Pure state rendering; no collection, configuration, or side effects."""
import json
from typing import Any


def quote_yaml(value: str) -> str:
    return json.dumps(value, ensure_ascii=True)


def yaml_lines(value: Any, indent: int = 0) -> list[str]:
    pad = " " * indent
    if isinstance(value, dict):
        lines: list[str] = []
        for key, child in value.items():
            label = key if isinstance(key, str) and key.replace("_", "").isalnum() else quote_yaml(str(key))
            if isinstance(child, (dict, list)):
                if child:
                    lines.append(f"{pad}{label}:")
                    lines.extend(yaml_lines(child, indent + 2))
                else:
                    lines.append(f"{pad}{label}: {json.dumps(child)}")
            else:
                lines.append(f"{pad}{label}: {yaml_scalar(child)}")
        return lines
    if isinstance(value, list):
        lines = []
        for child in value:
            if isinstance(child, dict):
                if child:
                    first, *rest = yaml_lines(child, indent + 2)
                    lines.append(f"{pad}- {first.strip()}")
                    lines.extend(rest)
                else:
                    lines.append(f"{pad}- {{}}")
            elif isinstance(child, list):
                if child:
                    lines.append(f"{pad}-")
                    lines.extend(yaml_lines(child, indent + 2))
                else:
                    lines.append(f"{pad}- []")
            else:
                lines.append(f"{pad}- {yaml_scalar(child)}")
        return lines
    return [f"{pad}{yaml_scalar(value)}"]


def yaml_scalar(value: Any) -> str:
    if value is True:
        return "true"
    if value is False:
        return "false"
    if value is None:
        return "null"
    if isinstance(value, (int, float)):
        return str(value)
    return quote_yaml(str(value))


def compact_state(states: list[dict[str, Any]]) -> dict[str, Any]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for state in states:
        state = dict(state)
        platform_name = state.pop("platform")
        grouped.setdefault(platform_name, []).append(state)
    return {
        platform_name: values[0] if len(values) == 1 else values
        for platform_name, values in grouped.items()
    }


def prepare_view(output: dict, *, app_id=None, full=False) -> dict:
    """Apply display filtering after collection/cache storage; never drop coverage."""
    for state in output['devices']:
        if app_id:
            state['surfaces'] = [s for s in state.get('surfaces', []) if s.get('app_id') == app_id]
            state['apps'] = {k: v for k, v in state.get('apps', {}).items() if v.get('app_id') == app_id}
            state['browsers'] = [b for b in state.get('browsers', []) if b.get('app_id') == app_id]
        if full:
            continue
        surfaces = state.get('surfaces', [])
        state['surface_count'] = len(surfaces)
        state['omitted_surfaces'] = max(0, len(surfaces) - 40)
        state['surfaces'] = [{
            key: value[:180] if isinstance(value, str) and key in {'title', 'url'} else value
            for key, value in surface.items() if key not in {'bounds', 'path', 'capabilities', 'observed_at'}
        } for surface in surfaces[:40]]
        state['apps'] = [{
            key: value for key, value in app.items()
            if key in {'name', 'app_id', 'instance_id', 'pid', 'session_id'}
        } for app in state.get('apps', {}).values()][:40]
        state['browsers'] = [{
            key: value for key, value in browser.items()
            if key in {'name', 'app_id', 'status', 'reason', 'tab_inventory', 'tab_inventories'}
        } for browser in state.get('browsers', [])]
    return output

