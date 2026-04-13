"""GHL Invoices, Templates, Schedules, Estimates, Text2Pay."""


class InvoicesMixin:

    # ── Invoices ──

    def list_invoices(self, limit=20, **params):
        p = {"altId": self.location_id, "altType": "location", "limit": limit}
        p.update(params)
        return self._request("GET", "/invoices/", params=p)

    def create_invoice(self, **fields):
        fields.setdefault("altId", self.location_id)
        fields.setdefault("altType", "location")
        return self._request("POST", "/invoices/", fields)

    def get_invoice(self, invoice_id):
        return self._request("GET", f"/invoices/{invoice_id}")

    def update_invoice(self, invoice_id, **fields):
        return self._request("PUT", f"/invoices/{invoice_id}", fields)

    def delete_invoice(self, invoice_id):
        return self._request("DELETE", f"/invoices/{invoice_id}")

    def void_invoice(self, invoice_id):
        return self._request("POST", f"/invoices/{invoice_id}/void")

    def send_invoice(self, invoice_id):
        return self._request("POST", f"/invoices/{invoice_id}/send")

    def record_payment(self, invoice_id, **fields):
        return self._request("POST", f"/invoices/{invoice_id}/record-payment", fields)

    def generate_invoice_number(self):
        return self._request("GET", "/invoices/generate-invoice-number",
                             params={"altId": self.location_id, "altType": "location"})

    def get_invoice_settings(self):
        return self._request("GET", "/invoices/settings",
                             params={"altId": self.location_id, "altType": "location"})

    # ── Invoice Templates ──

    def list_invoice_templates(self):
        return self._request("GET", "/invoices/template",
                             params={"altId": self.location_id, "altType": "location"})

    def create_invoice_template(self, **fields):
        fields.setdefault("altId", self.location_id)
        fields.setdefault("altType", "location")
        return self._request("POST", "/invoices/template", fields)

    def get_invoice_template(self, template_id):
        return self._request("GET", f"/invoices/template/{template_id}")

    def update_invoice_template(self, template_id, **fields):
        return self._request("PUT", f"/invoices/template/{template_id}", fields)

    def delete_invoice_template(self, template_id):
        return self._request("DELETE", f"/invoices/template/{template_id}")

    # ── Invoice Schedules ──

    def list_invoice_schedules(self):
        return self._request("GET", "/invoices/schedule",
                             params={"altId": self.location_id, "altType": "location"})

    def create_invoice_schedule(self, **fields):
        return self._request("POST", "/invoices/schedule", fields)

    def get_invoice_schedule(self, schedule_id):
        return self._request("GET", f"/invoices/schedule/{schedule_id}")

    def update_invoice_schedule(self, schedule_id, **fields):
        return self._request("PUT", f"/invoices/schedule/{schedule_id}", fields)

    def delete_invoice_schedule(self, schedule_id):
        return self._request("DELETE", f"/invoices/schedule/{schedule_id}")

    # ── Estimates ──

    def list_estimates(self):
        return self._request("GET", "/invoices/estimate",
                             params={"altId": self.location_id, "altType": "location"})

    def create_estimate(self, **fields):
        return self._request("POST", "/invoices/estimate", fields)

    def get_estimate(self, estimate_id):
        return self._request("GET", f"/invoices/estimate/{estimate_id}")

    def update_estimate(self, estimate_id, **fields):
        return self._request("PUT", f"/invoices/estimate/{estimate_id}", fields)

    def delete_estimate(self, estimate_id):
        return self._request("DELETE", f"/invoices/estimate/{estimate_id}")

    # ── Text2Pay ──

    def create_text2pay(self, **fields):
        return self._request("POST", "/invoices/text2pay", fields)
