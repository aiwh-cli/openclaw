"""GHL Conversations & Messages."""


class ConversationsMixin:

    def create_conversation(self, contact_id):
        return self._request("POST", "/conversations/", {
            "locationId": self.location_id, "contactId": contact_id})

    def get_conversation(self, conversation_id):
        return self._request("GET", f"/conversations/{conversation_id}")

    def update_conversation(self, conversation_id, **fields):
        return self._request("PUT", f"/conversations/{conversation_id}", fields)

    def delete_conversation(self, conversation_id):
        return self._request("DELETE", f"/conversations/{conversation_id}")

    def search_conversations(self, query=None, limit=20, **params):
        p = {"locationId": self.location_id, "limit": limit}
        if query: p["q"] = query
        p.update(params)
        return self._request("GET", "/conversations/search", params=p)

    def get_messages(self, conversation_id, limit=20):
        return self._request("GET", f"/conversations/{conversation_id}/messages",
                             params={"limit": limit})

    def get_message(self, message_id):
        return self._request("GET", f"/conversations/messages/{message_id}")

    def send_message(self, conversation_id=None, message_type="SMS",
                     message="", contact_id=None, **kwargs):
        body = {"type": message_type, "message": message}
        if conversation_id: body["conversationId"] = conversation_id
        if contact_id: body["contactId"] = contact_id
        body.update(kwargs)
        return self._request("POST", "/conversations/messages", body)

    def add_inbound_message(self, conversation_id=None, contact_id=None,
                            message_type="Custom", message="", **kwargs):
        body = {"type": message_type, "message": message}
        if conversation_id: body["conversationId"] = conversation_id
        if contact_id: body["contactId"] = contact_id
        body.update(kwargs)
        return self._request("POST", "/conversations/messages/inbound", body)

    def update_message_status(self, message_id, status):
        return self._request("PUT", f"/conversations/messages/{message_id}/status",
                             {"status": status})

    def get_call_recordings(self, conversation_id, message_id):
        return self._request("GET",
                             f"/conversations/{conversation_id}/messages/{message_id}/recordings")
