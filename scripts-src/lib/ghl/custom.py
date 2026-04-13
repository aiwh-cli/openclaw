"""GHL Custom Fields & Custom Values."""


class CustomFieldsMixin:

    def list_custom_fields(self, model="contact", **params):
        params.setdefault("locationId", self.location_id)
        params["model"] = model
        return self._request("GET", "/custom-fields/", params=params)

    def create_custom_field(self, name, data_type, model="contact", **fields):
        fields["name"] = name
        fields["dataType"] = data_type
        fields["model"] = model
        fields.setdefault("locationId", self.location_id)
        return self._request("POST", "/custom-fields/", fields)

    def get_custom_field(self, field_id):
        return self._request("GET", f"/custom-fields/{field_id}")

    def update_custom_field(self, field_id, **fields):
        return self._request("PUT", f"/custom-fields/{field_id}", fields)

    def delete_custom_field(self, field_id):
        return self._request("DELETE", f"/custom-fields/{field_id}")


class CustomValuesMixin:

    def list_custom_values(self, **params):
        params.setdefault("locationId", self.location_id)
        return self._request("GET", "/custom-values/", params=params)

    def create_custom_value(self, name, value, **fields):
        fields["name"] = name
        fields["value"] = value
        fields.setdefault("locationId", self.location_id)
        return self._request("POST", "/custom-values/", fields)

    def get_custom_value(self, custom_value_id):
        return self._request("GET", f"/custom-values/{custom_value_id}")

    def update_custom_value(self, custom_value_id, **fields):
        return self._request("PUT", f"/custom-values/{custom_value_id}", fields)

    def delete_custom_value(self, custom_value_id):
        return self._request("DELETE", f"/custom-values/{custom_value_id}")
