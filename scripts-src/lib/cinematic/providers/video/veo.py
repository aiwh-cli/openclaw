"""Google Vertex AI Veo 3.1 video generation provider.

Supports first+last frame interpolation for cinematic motion.
Auth via gcloud OAuth2 tokens (not API keys).
"""

import base64
import json
import os
import time
import urllib.request

from cinematic.providers.base import VideoProvider
from cinematic.config import (
    gcloud_token, vertex_headers, vertex_base_url, google_region,
)
from cinematic.utils import sanitize_prompt


class VeoProvider(VideoProvider):
    """Veo 3.1 Fast video generation on Google Vertex AI."""

    def __init__(self, config):
        super().__init__(config)
        self.model = config.get('model', 'veo-3.1-fast-generate-preview')

    def generate(self, prompt, first_frame_path, last_frame_path=None,
                 duration=8, aspect_ratio="16:9"):
        """Submit Veo video generation. Returns operation name or None."""
        prompt = sanitize_prompt(prompt)

        # Encode first frame
        with open(first_frame_path, "rb") as f:
            first_b64 = base64.b64encode(f.read()).decode()
        ext = "png" if first_frame_path.endswith(".png") else "jpeg"

        instance = {
            "prompt": prompt[:1500],
            "image": {
                "bytesBase64Encoded": first_b64,
                "mimeType": f"image/{ext}"
            }
        }

        # Add last frame for interpolation
        if last_frame_path and os.path.exists(last_frame_path):
            with open(last_frame_path, "rb") as f:
                last_b64 = base64.b64encode(f.read()).decode()
            last_ext = "png" if last_frame_path.endswith(".png") else "jpeg"
            instance["lastFrame"] = {
                "bytesBase64Encoded": last_b64,
                "mimeType": f"image/{last_ext}"
            }
            print("    Veo 3.1: first+last frame interpolation mode")
        else:
            print("    Veo 3.1: single image-to-video mode")

        # Veo supports 16:9 and 9:16 only
        veo_ar = aspect_ratio if aspect_ratio in ("16:9", "9:16") else "16:9"
        params = {
            "aspectRatio": veo_ar,
            "sampleCount": 1,
            "generateAudio": False
        }

        base_url = vertex_base_url()
        resp = self._api_call(
            f"{base_url}/{self.model}:predictLongRunning",
            {"instances": [instance], "parameters": params},
            vertex_headers()
        )

        if resp and "name" in resp:
            return resp["name"]

        if resp:
            err = resp.get("error", {}).get("message", str(resp)[:200])
            print(f"    Veo 3.1: {err}")
        return None

    def poll(self, operation_name, timeout=600):
        """Poll Veo long-running operation. Returns video URI or None."""
        model_path = operation_name.rsplit("/operations/", 1)[0]
        region = google_region()
        poll_url = (
            f"https://{region}-aiplatform.googleapis.com/v1/"
            f"{model_path}:fetchPredictOperation"
        )

        elapsed = 0
        while elapsed < timeout:
            time.sleep(15)
            elapsed += 15
            try:
                body = json.dumps(
                    {"operationName": operation_name}).encode()
                req = urllib.request.Request(
                    poll_url, data=body,
                    headers={
                        "Authorization": f"Bearer {gcloud_token()}",
                        "Content-Type": "application/json"
                    }
                )
                with urllib.request.urlopen(req, timeout=60) as resp:
                    data = json.loads(resp.read())
            except Exception as e:
                print(f"    Veo poll error: {e}")
                continue

            if data.get("done"):
                err = data.get("error", {})
                if err:
                    msg = err.get('message', str(err)[:200])
                    print(f"    Veo FAILED: {msg}")
                    return None

                response = data.get("response", {})
                result = self._extract_video(response)
                if result:
                    return result

                rai = response.get("raiMediaFilteredCount", 0)
                if rai:
                    print(f"    Veo: {rai} video(s) filtered by safety "
                          "-- try adjusting prompt")
                else:
                    print(f"    Veo: done but no video in response: "
                          f"{json.dumps(response)[:300]}")
                return None

            # Show metadata progress
            meta = data.get("metadata", {})
            state = meta.get("state", "")
            pct = meta.get("progressPercent", "")
            status_msg = f"{state} {pct}%" if state else ""
            print(f"    Veo: polling... {elapsed}s {status_msg}")

        print(f"    Veo: TIMEOUT after {timeout}s")
        return None

    def download(self, video_uri, dest_path):
        """Download video from Veo result (GCS URI or base64)."""
        try:
            if video_uri.startswith("base64:"):
                with open(dest_path, 'wb') as f:
                    f.write(base64.b64decode(video_uri[7:]))
            elif video_uri.startswith("gs://"):
                import subprocess
                subprocess.run(
                    ["gsutil", "cp", video_uri, str(dest_path)],
                    capture_output=True, timeout=120
                )
            else:
                req = urllib.request.Request(
                    video_uri,
                    headers={
                        "Authorization": f"Bearer {gcloud_token()}"
                    }
                )
                with urllib.request.urlopen(req, timeout=120) as resp:
                    with open(dest_path, 'wb') as f:
                        f.write(resp.read())
            return (os.path.exists(dest_path)
                    and os.path.getsize(dest_path) > 0)
        except Exception as e:
            print(f"    Veo download error: {e}")
            return False

    # ── Internal helpers ─────────────────────────────────────────

    @staticmethod
    def _extract_video(response):
        """Extract video data from Vertex AI response."""
        # Vertex AI format: response.videos[].bytesBase64Encoded
        videos = response.get("videos", [])
        if videos:
            b64 = videos[0].get("bytesBase64Encoded", "")
            if b64:
                return f"base64:{b64}"
            gcs = videos[0].get("gcsUri", "")
            if gcs:
                return gcs

        # Fallback: response.predictions[]
        predictions = response.get("predictions", [])
        if predictions:
            b64 = predictions[0].get("bytesBase64Encoded", "")
            if b64:
                return f"base64:{b64}"
            gcs = predictions[0].get("gcsUri", "")
            if gcs:
                return gcs

        return None

    @staticmethod
    def _api_call(url, data, headers):
        """Simple POST wrapper for Vertex AI calls."""
        from cinematic.utils import api_call
        return api_call(url, data, headers, retries=3)
