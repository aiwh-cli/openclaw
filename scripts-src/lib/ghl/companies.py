"""GHL Companies."""


class CompaniesMixin:

    def list_companies(self, **params):
        params.setdefault("locationId", self.location_id)
        return self._request("GET", "/companies/", params=params)

    def create_company(self, **fields):
        fields.setdefault("locationId", self.location_id)
        return self._request("POST", "/companies/", fields)

    def get_company(self, company_id):
        return self._request("GET", f"/companies/{company_id}")

    def update_company(self, company_id, **fields):
        return self._request("PUT", f"/companies/{company_id}", fields)

    def delete_company(self, company_id):
        return self._request("DELETE", f"/companies/{company_id}")
