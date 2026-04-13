"""GHL Social Planner — posts, accounts, OAuth."""


class SocialMixin:

    def list_social_posts(self, **params):
        params.setdefault("locationId", self.location_id)
        return self._request("GET", "/social-media-posting/posts", params=params)

    def create_social_post(self, **fields):
        fields.setdefault("locationId", self.location_id)
        return self._request("POST", "/social-media-posting/posts", fields)

    def get_social_post(self, post_id):
        return self._request("GET", f"/social-media-posting/posts/{post_id}")

    def update_social_post(self, post_id, **fields):
        return self._request("PUT", f"/social-media-posting/posts/{post_id}", fields)

    def delete_social_post(self, post_id):
        return self._request("DELETE", f"/social-media-posting/posts/{post_id}")

    def list_social_accounts(self):
        return self._request("GET",
                             f"/social-media-posting/{self.location_id}/accounts")

    def disconnect_social_account(self, account_id):
        return self._request("DELETE",
                             f"/social-media-posting/{self.location_id}/accounts/{account_id}")
