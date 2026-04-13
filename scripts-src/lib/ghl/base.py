"""
GHL API Base Client — shared HTTP logic, auth, retry, error handling.
All domain modules inherit from this via mixins on GHLClient.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
import urllib.parse

API_BASE = "https://services.leadconnectorhq.com"
API_VERSION = "2021-07-28"
MAX_RETRIES = 3
BACKOFF_BASE = 2


class GHLError(Exception):
    """GHL API error with status code and message."""
    def __init__(self, status, message, body=None):
        self.status = status
        self.body = body
        super().__init__(f"GHL {status}: {message}")


class GHLBase:
    """Base client with HTTP transport, auth, and retry logic."""

    def __init__(self, api_key=None, location_id=None):
        self.api_key = api_key or os.environ.get("GHL_API_KEY", "")
        self.location_id = location_id or os.environ.get("GHL_LOCATION_ID", "")
        if not self.api_key:
            raise GHLError(0, "GHL_API_KEY not set")
        if not self.location_id:
            raise GHLError(0, "GHL_LOCATION_ID not set")

    def _request(self, method, path, body=None, params=None):
        """Base request with Bearer auth and 429 backoff."""
        url = f"{API_BASE}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Version": API_VERSION,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "AIWH-CRM/1.0",
        }
        data = json.dumps(body).encode() if body else None

        for attempt in range(MAX_RETRIES):
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    raw = resp.read().decode()
                    return json.loads(raw) if raw.strip() else {}
            except urllib.error.HTTPError as e:
                resp_body = e.read().decode() if e.fp else ""
                if e.code == 429:
                    wait = BACKOFF_BASE ** (attempt + 1)
                    print(f"Rate limited, waiting {wait}s...", file=sys.stderr)
                    time.sleep(wait)
                    continue
                raise GHLError(e.code, resp_body, resp_body)
            except urllib.error.URLError as e:
                if attempt < MAX_RETRIES - 1:
                    time.sleep(BACKOFF_BASE)
                    continue
                raise GHLError(0, f"Network error: {e.reason}")
        raise GHLError(429, "Rate limit exceeded after retries")

    def _upload(self, path, file_path, fields=None):
        """Multipart file upload (for media, forms, etc.)."""
        import mimetypes
        boundary = f"----AIWH{int(time.time() * 1000)}"
        body_parts = []

        if fields:
            for key, val in fields.items():
                body_parts.append(
                    f"--{boundary}\r\n"
                    f'Content-Disposition: form-data; name="{key}"\r\n\r\n'
                    f"{val}\r\n"
                )

        mime_type = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
        filename = os.path.basename(file_path)
        with open(file_path, "rb") as f:
            file_data = f.read()

        body_parts.append(
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: {mime_type}\r\n\r\n"
        )
        body_bytes = "".join(body_parts).encode() + file_data + f"\r\n--{boundary}--\r\n".encode()

        url = f"{API_BASE}{path}"
        req = urllib.request.Request(url, data=body_bytes, method="POST")
        req.add_header("Authorization", f"Bearer {self.api_key}")
        req.add_header("Version", API_VERSION)
        req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")

        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw.strip() else {}
        except urllib.error.HTTPError as e:
            resp_body = e.read().decode() if e.fp else ""
            raise GHLError(e.code, resp_body, resp_body)
