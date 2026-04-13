"""GHL Contacts, Tags, Notes, Tasks — contact-centric operations."""


class ContactsMixin:

    def create_contact(self, email=None, phone=None, first_name=None,
                       last_name=None, name=None, tags=None,
                       custom_fields=None, **kwargs):
        body = {"locationId": self.location_id}
        if email: body["email"] = email
        if phone: body["phone"] = phone
        if first_name: body["firstName"] = first_name
        if last_name: body["lastName"] = last_name
        if name: body["name"] = name
        if tags: body["tags"] = tags
        if custom_fields: body["customFields"] = custom_fields
        body.update(kwargs)
        return self._request("POST", "/contacts/", body)

    def get_contact(self, contact_id):
        return self._request("GET", f"/contacts/{contact_id}")

    def update_contact(self, contact_id, **fields):
        return self._request("PUT", f"/contacts/{contact_id}", fields)

    def upsert_contact(self, email=None, phone=None, **fields):
        body = {"locationId": self.location_id}
        if email: body["email"] = email
        if phone: body["phone"] = phone
        body.update(fields)
        return self._request("POST", "/contacts/upsert", body)

    def list_contacts(self, limit=20, query=None, **params):
        p = {"locationId": self.location_id, "limit": limit}
        if query: p["query"] = query
        p.update(params)
        return self._request("GET", "/contacts/", params=p)

    def search_contacts(self, query, limit=20):
        return self.list_contacts(limit=limit, query=query)

    def delete_contact(self, contact_id):
        return self._request("DELETE", f"/contacts/{contact_id}")

    def get_contacts_by_business(self, business_id):
        return self._request("GET", f"/contacts/business/{business_id}")

    # ── Tags ──

    def add_tags(self, contact_id, tags):
        return self._request("POST", f"/contacts/{contact_id}/tags", {"tags": tags})

    def remove_tags(self, contact_id, tags):
        return self._request("DELETE", f"/contacts/{contact_id}/tags", {"tags": tags})

    # ── Notes ──

    def get_notes(self, contact_id):
        return self._request("GET", f"/contacts/{contact_id}/notes")

    def create_note(self, contact_id, body_text):
        return self._request("POST", f"/contacts/{contact_id}/notes", {"body": body_text})

    # ── Tasks ──

    def get_tasks(self, contact_id):
        return self._request("GET", f"/contacts/{contact_id}/tasks")

    def create_task(self, contact_id, title, due_date=None, description=None, **kwargs):
        body = {"title": title}
        if due_date: body["dueDate"] = due_date
        if description: body["description"] = description
        body.update(kwargs)
        return self._request("POST", f"/contacts/{contact_id}/tasks", body)

    # ── Contact sub-resources ──

    def get_contact_appointments(self, contact_id):
        return self._request("GET", f"/contacts/{contact_id}/appointments")

    def get_contact_campaigns(self, contact_id):
        return self._request("GET", f"/contacts/{contact_id}/campaigns")

    def add_to_workflow(self, contact_id, workflow_id):
        return self._request("POST", f"/contacts/{contact_id}/workflow/{workflow_id}",
                             {"eventStartTime": ""})

    def remove_from_workflow(self, contact_id, workflow_id):
        return self._request("DELETE", f"/contacts/{contact_id}/workflow/{workflow_id}")
