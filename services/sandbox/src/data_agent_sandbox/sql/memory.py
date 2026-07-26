from __future__ import annotations

import sys
from pathlib import Path


def _linux_vm_hwm_bytes() -> int:
    try:
        status = Path("/proc/self/status").read_text(encoding="utf-8")
    except OSError:
        return 0
    for line in status.splitlines():
        if not line.startswith("VmHWM:"):
            continue
        fields = line.split()
        if len(fields) != 3 or fields[2] != "kB":
            return 0
        try:
            high_water_kb = int(fields[1])
        except ValueError:
            return 0
        return max(0, high_water_kb) * 1_024
    return 0


def observe_process_rss_high_water_bytes() -> int:
    """Best-effort process RSS high-water observation, never a hard memory-limit claim."""

    if sys.platform.startswith("linux"):
        observed = _linux_vm_hwm_bytes()
        if observed > 0:
            return observed
    try:
        import resource
    except ImportError:
        return 0
    try:
        observed = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    except (AttributeError, OSError, ValueError):
        return 0
    if observed <= 0:
        return 0
    # Darwin reports bytes; Linux and the other supported Unix runtimes report KiB.
    return observed if sys.platform == "darwin" else observed * 1_024
