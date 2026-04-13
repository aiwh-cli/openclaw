"""
GoHighLevel API Client Package for AIWH.
Assembles GHLClient from domain-specific mixins.

Usage:
    from ghl import GHLClient, GHLError
    client = GHLClient()  # reads GHL_API_KEY + GHL_LOCATION_ID from env
    contacts = client.list_contacts()
"""
from .base import GHLBase, GHLError
from .contacts import ContactsMixin
from .conversations import ConversationsMixin
from .calendars import CalendarsMixin
from .opportunities import OpportunitiesMixin
from .invoices import InvoicesMixin
from .payments import PaymentsMixin
from .social import SocialMixin
from .media import MediaMixin
from .companies import CompaniesMixin
from .custom import CustomFieldsMixin, CustomValuesMixin
from .misc import (
    WorkflowsMixin, FunnelsMixin, FormsMixin, SurveysMixin,
    CoursesMixin, BusinessesMixin, UsersMixin, LocationsMixin,
    WebhooksMixin, DocumentsMixin, SnapshotsMixin, AssociationsMixin,
    ProductsMixin,
)


class GHLClient(
    GHLBase,
    ContactsMixin,
    ConversationsMixin,
    CalendarsMixin,
    OpportunitiesMixin,
    InvoicesMixin,
    PaymentsMixin,
    SocialMixin,
    MediaMixin,
    CompaniesMixin,
    CustomFieldsMixin,
    CustomValuesMixin,
    WorkflowsMixin,
    FunnelsMixin,
    FormsMixin,
    SurveysMixin,
    CoursesMixin,
    BusinessesMixin,
    UsersMixin,
    LocationsMixin,
    WebhooksMixin,
    DocumentsMixin,
    SnapshotsMixin,
    AssociationsMixin,
    ProductsMixin,
):
    """Full GHL API client — all domains via mixins."""
    pass


__all__ = ["GHLClient", "GHLError"]
