import http.server
import os


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    port = 8000
    print(f"Serving Chromatic Explorer at http://localhost:{port}")
    http.server.test(HandlerClass=http.server.SimpleHTTPRequestHandler, port=port)


if __name__ == "__main__":
    main()
