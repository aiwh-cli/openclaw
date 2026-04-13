"""Google Vertex AI Imagen 3 image generation provider.

Auth via gcloud OAuth2 tokens (shared with Veo provider).
"""

import base64
import os
from pathlib import Path

from cinematic.providers.base import ImageProvider
from cinematic.config import vertex_headers, vertex_base_url
from cinematic.utils import sanitize_prompt, api_call


class ImagenProvider(ImageProvider):
    """Imagen 3 image generation on Google Vertex AI."""

    def __init__(self, config):
        super().__init__(config)
        self.model = config.get('model', 'imagen-3.0-generate-002')

    def generate(self, prompt, dest_dir, filename, aspect_ratio="16:9"):
        """Generate image via Imagen 3. Returns local path or None."""
        prompt = sanitize_prompt(prompt)
        print("    Imagen: generating...")

        base_url = vertex_base_url()
        resp = api_call(
            f"{base_url}/{self.model}:predict",
            {
                "instances": [{"prompt": prompt[:1500]}],
                "parameters": {
                    "sampleCount": 1,
                    "aspectRatio": aspect_ratio,
                    "personGeneration": "allow_all",
                    "outputOptions": {"mimeType": "image/png"}
                }
            },
            vertex_headers()
        )

        if not resp:
            print("    Imagen: API call failed")
            return None

        predictions = resp.get("predictions", [])
        if not predictions:
            err = resp.get("error", {}).get(
                "message", "no predictions returned")
            print(f"    Imagen: {err}")
            return None

        img_b64 = predictions[0].get("bytesBase64Encoded", "")
        if not img_b64:
            print("    Imagen: no image data in response")
            return None

        dest = Path(dest_dir) / filename
        with open(dest, "wb") as f:
            f.write(base64.b64decode(img_b64))

        if dest.exists() and os.path.getsize(dest) > 0:
            print(f"    Imagen: saved {filename}")
            return str(dest)
        return None
