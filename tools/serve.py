#!/usr/bin/env python3
"""Development server for Chromatic Explorer."""

import http.server
import os
from pathlib import Path


def main():
    app_dir = Path(__file__).resolve().parent.parent / "app"
    os.chdir(app_dir)
    port = 8000
    print(f"Serving Chromatic Explorer at http://localhost:{port}")
    print(f"  Root: {app_dir}")
    http.server.test(HandlerClass=http.server.SimpleHTTPRequestHandler, port=port)


if __name__ == "__main__":
    main()
