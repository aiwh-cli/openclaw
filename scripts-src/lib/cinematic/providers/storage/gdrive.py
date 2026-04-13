"""Google Drive storage provider via gog CLI.

Uploads files and makes them publicly accessible for downstream
providers (e.g., HeyGen needs a public audio URL).
"""

import json
import subprocess

from cinematic.providers.base import StorageProvider


class GDriveProvider(StorageProvider):
    """Google Drive storage via gog CLI."""

    def upload(self, local_path):
        """Upload file to Google Drive. Returns public URL or None."""
        try:
            result = subprocess.run(
                ["gog", "drive", "upload", str(local_path), "--json"],
                capture_output=True, text=True, timeout=60
            )
            if result.returncode != 0:
                print(f"    GDrive upload failed: {result.stderr[:200]}")
                return None

            resp = json.loads(result.stdout)
            file_id = resp.get("file", {}).get("id") or resp.get("id")
            if not file_id:
                print("    GDrive: no file ID in response")
                return None

            # Make public
            subprocess.run(
                ["gog", "drive", "share", file_id,
                 "--to", "anyone", "--role", "reader"],
                capture_output=True, text=True, timeout=30
            )
            return self.get_public_url(file_id)
        except Exception as e:
            print(f"    GDrive upload error: {e}")
            return None

    def get_public_url(self, file_id):
        """Get public download URL for a Google Drive file."""
        return f"https://drive.google.com/uc?id={file_id}&export=download"
