"""GHL misc domains: workflows, funnels, forms, surveys, courses,
businesses, users, locations, tags, webhooks, documents, snapshots, associations, products."""


class WorkflowsMixin:
    def list_workflows(self):
        return self._request("GET", "/workflows/",
                             params={"locationId": self.location_id})

    def get_workflow(self, workflow_id):
        return self._request("GET", f"/workflows/{workflow_id}")


class FunnelsMixin:
    def list_funnels(self):
        return self._request("GET", "/funnels/",
                             params={"locationId": self.location_id})

    def get_funnel(self, funnel_id):
        return self._request("GET", f"/funnels/{funnel_id}")

    def list_funnel_pages(self, **params):
        params.setdefault("locationId", self.location_id)
        return self._request("GET", "/funnels/pages", params=params)


class FormsMixin:
    def list_forms(self):
        return self._request("GET", "/forms/",
                             params={"locationId": self.location_id})

    def get_form_submissions(self, form_id=None, limit=20, **params):
        p = {"locationId": self.location_id, "limit": limit}
        if form_id: p["formId"] = form_id
        p.update(params)
        return self._request("GET", "/forms/submissions", params=p)


class SurveysMixin:
    def list_surveys(self):
        return self._request("GET", "/surveys/",
                             params={"locationId": self.location_id})

    def get_survey_submissions(self, survey_id=None, limit=20, **params):
        p = {"locationId": self.location_id, "limit": limit}
        if survey_id: p["surveyId"] = survey_id
        p.update(params)
        return self._request("GET", "/surveys/submissions", params=p)


class CoursesMixin:
    def list_courses(self):
        return self._request("GET", "/courses/",
                             params={"locationId": self.location_id})

    def get_course(self, course_id):
        return self._request("GET", f"/courses/{course_id}")

    def enroll_contact(self, course_id, contact_id, **fields):
        fields["contactId"] = contact_id
        return self._request("POST", f"/courses/{course_id}/enrollments", fields)

    def list_enrollments(self, course_id):
        return self._request("GET", f"/courses/{course_id}/enrollments")

    def remove_enrollment(self, course_id, enrollment_id):
        return self._request("DELETE", f"/courses/{course_id}/enrollments/{enrollment_id}")


class BusinessesMixin:
    def list_businesses(self):
        return self._request("GET", "/businesses/",
                             params={"locationId": self.location_id})

    def create_business(self, **fields):
        fields.setdefault("locationId", self.location_id)
        return self._request("POST", "/businesses/", fields)

    def get_business(self, business_id):
        return self._request("GET", f"/businesses/{business_id}")

    def update_business(self, business_id, **fields):
        return self._request("PUT", f"/businesses/{business_id}", fields)

    def delete_business(self, business_id):
        return self._request("DELETE", f"/businesses/{business_id}")


class UsersMixin:
    def list_users(self):
        return self._request("GET", "/users/",
                             params={"locationId": self.location_id})

    def get_user(self, user_id):
        return self._request("GET", f"/users/{user_id}")

    def search_users(self, **params):
        params.setdefault("locationId", self.location_id)
        return self._request("GET", "/users/search", params=params)


class LocationsMixin:
    def get_location(self, location_id=None):
        lid = location_id or self.location_id
        return self._request("GET", f"/locations/{lid}")

    def list_location_tags(self):
        return self._request("GET", f"/locations/{self.location_id}/tags")

    def create_location_tag(self, name):
        return self._request("POST", f"/locations/{self.location_id}/tags",
                             {"name": name})

    def update_location_tag(self, tag_id, name):
        return self._request("PUT", f"/locations/{self.location_id}/tags/{tag_id}",
                             {"name": name})

    def delete_location_tag(self, tag_id):
        return self._request("DELETE", f"/locations/{self.location_id}/tags/{tag_id}")


class WebhooksMixin:
    def list_webhooks(self):
        return self._request("GET", "/webhooks/",
                             params={"locationId": self.location_id})

    def create_webhook(self, url, events):
        return self._request("POST", "/webhooks/", {
            "locationId": self.location_id, "url": url, "events": events})

    def delete_webhook(self, webhook_id):
        return self._request("DELETE", f"/webhooks/{webhook_id}")


class DocumentsMixin:
    def list_documents(self, **params):
        params.setdefault("locationId", self.location_id)
        return self._request("GET", "/documents/", params=params)

    def get_document(self, document_id):
        return self._request("GET", f"/documents/{document_id}")


class SnapshotsMixin:
    def list_snapshots(self, company_id):
        return self._request("GET", "/snapshots/", params={"companyId": company_id})

    def create_snapshot_share_link(self, snapshot_id, **fields):
        return self._request("POST", "/snapshots/share/link", fields)


class AssociationsMixin:
    def list_associations(self, **params):
        return self._request("GET", "/associations/", params=params)

    def create_association(self, **fields):
        return self._request("POST", "/associations/", fields)

    def get_association(self, association_id):
        return self._request("GET", f"/associations/{association_id}")

    def delete_association(self, association_id):
        return self._request("DELETE", f"/associations/{association_id}")


class ProductsMixin:
    def list_products(self, **params):
        params.setdefault("locationId", self.location_id)
        return self._request("GET", "/products/", params=params)

    def create_product(self, **fields):
        fields.setdefault("locationId", self.location_id)
        return self._request("POST", "/products/", fields)

    def get_product(self, product_id):
        return self._request("GET", f"/products/{product_id}")

    def update_product(self, product_id, **fields):
        return self._request("PUT", f"/products/{product_id}", fields)

    def delete_product(self, product_id):
        return self._request("DELETE", f"/products/{product_id}")
