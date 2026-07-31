#!/usr/bin/env python3
"""个人工作台 —— 静态文件 + 云同步 API（同一端口 8000）
  GET  /sync?key=XXX  -> 返回 {data, savedAt} 或 404
  POST /sync?key=XXX  -> 保存请求体 JSON，返回 {ok:true, savedAt}
同步数据存放在 <directory>/.sync/<key>.json
"""
import os, sys, json, time, re, threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

DIRECTORY = os.environ.get("WB_DIR", "/workspace")
SYNC_DIR = os.path.join(DIRECTORY, ".sync")
os.makedirs(SYNC_DIR, exist_ok=True)

KEY_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")
MAX_BODY = 8 * 1024 * 1024  # 8MB

_lock = threading.Lock()


def safe_path(key):
    if not KEY_RE.match(key or ""):
        return None
    return os.path.join(SYNC_DIR, f"{key}.json")


class Handler(SimpleHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _is_sync(self):
        # 支持 /sync 路径（本地开发）和 ?__sync=1（预览代理只转发根路径的场景）
        from urllib.parse import urlparse, parse_qs

        qs = parse_qs(urlparse(self.path).query)
        return self.path.startswith("/sync") or (qs.get("__sync") or [""])[0] == "1"

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self._is_sync():
            self.handle_sync("GET")
        else:
            super().do_GET()

    def do_POST(self):
        if self._is_sync():
            self.handle_sync("POST")
        else:
            self.send_error(405)

    def handle_sync(self, method):
        from urllib.parse import urlparse, parse_qs

        qs = parse_qs(urlparse(self.path).query)
        key = (qs.get("key") or [""])[0]
        path = safe_path(key)

        if method == "GET":
            if not path or not os.path.exists(path):
                self.send_response(404)
                self._cors()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"error":"not_found"}')
                return
            with open(path, "rb") as f:
                data = f.read()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        # POST
        if not path:
            self.send_error(400, "bad key")
            return
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length <= 0 or length > MAX_BODY:
            self.send_error(400, "bad body")
            return
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            self.send_error(400, "bad json")
            return
        saved = {"savedAt": int(time.time() * 1000), "data": body}
        with _lock:
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(saved, f, ensure_ascii=False)
            os.replace(tmp, path)
        resp = json.dumps({"ok": True, "savedAt": saved["savedAt"]}).encode("utf-8")
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(resp)))
        self.end_headers()
        self.wfile.write(resp)

    def list_directory(self, path):
        # 禁止列出目录
        self.send_error(403)
        return None

    def log_message(self, fmt, *args):
        pass


def main():
    port = int(os.environ.get("WB_PORT", "8000"))
    os.chdir(DIRECTORY)
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"[sync_server] serving {DIRECTORY} on :{port}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
