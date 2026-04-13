"""GHL Media Storage — files and folders."""


class MediaMixin:

    def list_media(self, **params):
        params.setdefault("locationId", self.location_id)
        return self._request("GET", "/medias/", params=params)

    def get_media(self, file_id):
        return self._request("GET", f"/medias/{file_id}")

    def update_media(self, file_id, **fields):
        return self._request("PUT", f"/medias/{file_id}", fields)

    def delete_media(self, file_id):
        return self._request("DELETE", f"/medias/{file_id}")

    def upload_media(self, file_path, name=None):
        fields = {"locationId": self.location_id}
        if name: fields["name"] = name
        return self._upload("/medias/upload-file", file_path, fields)

    def create_media_folder(self, name, **fields):
        fields["name"] = name
        fields.setdefault("locationId", self.location_id)
        return self._request("POST", "/medias/folder", fields)

    def delete_media_folder(self, folder_id):
        return self._request("DELETE", f"/medias/folder/{folder_id}")
