"""No-model probe; run on the Docker host using the control service environment."""

import json
import os
import socket
from unittest.mock import patch

from opensandbox_server.services.docker.port_allocator import allocate_host_port


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def main():
    # A Unix socket path alone cannot prove colocation: an SSH-forwarded socket
    # can also look local. Deployment must bind this process to the Docker host.
    if os.environ.get("DOCKER_HOST") != "unix:///var/run/docker.sock":
        raise RuntimeError("OPENSANDBOX_HOST_LOCAL_DOCKER_REQUIRED")
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as occupied:
        occupied.bind(("0.0.0.0", 0))
        occupied.listen(1)
        occupied_port = occupied.getsockname()[1]
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as candidate:
            candidate.bind(("0.0.0.0", 0))
            candidate_port = candidate.getsockname()[1]
        with patch(
            "opensandbox_server.services.docker.port_allocator.random.randint",
            side_effect=[occupied_port, candidate_port],
        ) as choose:
            result = allocate_host_port(attempts=2)
            require(
                result == candidate_port and choose.call_count == 2,
                "OPENSANDBOX_OCCUPIED_PORT_NOT_REJECTED",
            )
        with patch(
            "opensandbox_server.services.docker.port_allocator.random.randint",
            return_value=occupied_port,
        ) as choose:
            require(allocate_host_port(attempts=2) is None, "OPENSANDBOX_PORT_EXHAUSTION_OPEN")
            require(choose.call_count == 2, "OPENSANDBOX_PORT_ATTEMPT_BOUND_CHANGED")
    print(json.dumps({
        "status": "PASS",
        "occupied_host_port_rejected": True,
        "next_free_host_port_selected": True,
        "exhaustion_fails_closed": True,
        "model_calls": 0,
        "scope": "Host port probe only; not sandbox isolation or business acceptance.",
    }))


if __name__ == "__main__":
    main()
