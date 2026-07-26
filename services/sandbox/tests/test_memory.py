from __future__ import annotations

import sys

from data_agent_sandbox.sql.memory import observe_process_rss_high_water_bytes


def test_process_rss_high_water_observation_is_nonnegative_and_available_here() -> None:
    observed = observe_process_rss_high_water_bytes()

    assert observed >= 0
    if sys.platform == "darwin" or sys.platform.startswith("linux"):
        assert observed > 0
