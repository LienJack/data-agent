from __future__ import annotations

import asyncio
import logging
import sys

from data_agent_sandbox.protocol.ndjson import serve_single_execution


async def _main() -> None:
    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)
    await serve_single_execution(reader, sys.stdout)


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "python-server":
        from data_agent_sandbox.python_runtime.server import main as python_server_main

        sys.argv = [sys.argv[0], *sys.argv[2:]]
        python_server_main()
        return
    logging.basicConfig(stream=sys.stderr, level=logging.INFO)
    asyncio.run(_main())


if __name__ == "__main__":
    main()
