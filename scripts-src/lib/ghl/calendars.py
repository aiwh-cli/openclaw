"""GHL Calendars, Events, Groups, Resources."""


class CalendarsMixin:

    # ── Calendars ──

    def list_calendars(self):
        return self._request("GET", "/calendars/", params={"locationId": self.location_id})

    def create_calendar(self, **fields):
        fields.setdefault("locationId", self.location_id)
        return self._request("POST", "/calendars/", fields)

    def get_calendar(self, calendar_id):
        return self._request("GET", f"/calendars/{calendar_id}")

    def update_calendar(self, calendar_id, **fields):
        return self._request("PUT", f"/calendars/{calendar_id}", fields)

    def delete_calendar(self, calendar_id):
        return self._request("DELETE", f"/calendars/{calendar_id}")

    def get_free_slots(self, calendar_id, start_date, end_date, timezone=None):
        params = {"startDate": start_date, "endDate": end_date}
        if timezone: params["timezone"] = timezone
        return self._request("GET", f"/calendars/{calendar_id}/free-slots", params=params)

    # ── Calendar Groups ──

    def list_calendar_groups(self):
        return self._request("GET", "/calendars/groups",
                             params={"locationId": self.location_id})

    def create_calendar_group(self, **fields):
        fields.setdefault("locationId", self.location_id)
        return self._request("POST", "/calendars/groups", fields)

    def get_calendar_group(self, group_id):
        return self._request("GET", f"/calendars/groups/{group_id}")

    def update_calendar_group(self, group_id, **fields):
        return self._request("PUT", f"/calendars/groups/{group_id}", fields)

    def delete_calendar_group(self, group_id):
        return self._request("DELETE", f"/calendars/groups/{group_id}")

    # ── Calendar Events ──

    def list_events(self, **params):
        params.setdefault("locationId", self.location_id)
        return self._request("GET", "/calendars/events", params=params)

    def create_appointment(self, calendar_id, contact_id, start_time,
                           end_time, title=None, **kwargs):
        body = {
            "calendarId": calendar_id, "locationId": self.location_id,
            "contactId": contact_id, "startTime": start_time, "endTime": end_time,
        }
        if title: body["title"] = title
        body.update(kwargs)
        return self._request("POST", "/calendars/events", body)

    def get_event(self, event_id):
        return self._request("GET", f"/calendars/events/{event_id}")

    def update_event(self, event_id, **fields):
        return self._request("PUT", f"/calendars/events/{event_id}", fields)

    def delete_event(self, event_id):
        return self._request("DELETE", f"/calendars/events/{event_id}")

    # ── Calendar Resources ──

    def list_calendar_resources(self):
        return self._request("GET", "/calendars/resources",
                             params={"locationId": self.location_id})

    def create_calendar_resource(self, **fields):
        fields.setdefault("locationId", self.location_id)
        return self._request("POST", "/calendars/resources", fields)

    def update_calendar_resource(self, resource_id, **fields):
        return self._request("PUT", f"/calendars/resources/{resource_id}", fields)

    def delete_calendar_resource(self, resource_id):
        return self._request("DELETE", f"/calendars/resources/{resource_id}")
