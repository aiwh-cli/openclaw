"""GHL Opportunities & Pipelines."""


class OpportunitiesMixin:

    def list_pipelines(self):
        return self._request("GET", "/opportunities/pipelines",
                             params={"locationId": self.location_id})

    def get_pipeline(self, pipeline_id):
        return self._request("GET", f"/opportunities/pipelines/{pipeline_id}")

    def create_opportunity(self, pipeline_id, stage_id, name,
                           contact_id=None, monetary_value=None,
                           status="open", **kwargs):
        body = {
            "pipelineId": pipeline_id, "pipelineStageId": stage_id,
            "locationId": self.location_id, "name": name, "status": status,
        }
        if contact_id: body["contactId"] = contact_id
        if monetary_value is not None: body["monetaryValue"] = monetary_value
        body.update(kwargs)
        return self._request("POST", "/opportunities/", body)

    def get_opportunity(self, opportunity_id):
        return self._request("GET", f"/opportunities/{opportunity_id}")

    def update_opportunity(self, opportunity_id, **fields):
        return self._request("PUT", f"/opportunities/{opportunity_id}", fields)

    def delete_opportunity(self, opportunity_id):
        return self._request("DELETE", f"/opportunities/{opportunity_id}")

    def update_opportunity_status(self, opportunity_id, status):
        return self._request("PUT", f"/opportunities/{opportunity_id}/status",
                             {"status": status})

    def search_opportunities(self, pipeline_id=None, stage_id=None,
                             query=None, limit=20, **params):
        p = {"location_id": self.location_id, "limit": limit}
        if pipeline_id: p["pipeline_id"] = pipeline_id
        if stage_id: p["pipeline_stage_id"] = stage_id
        if query: p["q"] = query
        p.update(params)
        return self._request("GET", "/opportunities/search", params=p)

    def add_opportunity_followers(self, opportunity_id, followers):
        return self._request("POST", f"/opportunities/{opportunity_id}/followers",
                             {"followers": followers})

    def remove_opportunity_followers(self, opportunity_id, followers):
        return self._request("DELETE", f"/opportunities/{opportunity_id}/followers",
                             {"followers": followers})
