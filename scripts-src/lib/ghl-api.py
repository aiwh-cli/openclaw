#!/usr/bin/env python3
"""
GoHighLevel API CLI — thin wrapper over ghl/ package.
Usage: ghl-api.py <resource> <action> [--param value ...]

Resources: contacts, opportunities, conversations, calendars, invoices,
           payments, social, media, companies, custom-fields, custom-values,
           workflows, funnels, forms, surveys, courses, businesses, users,
           locations, webhooks, documents, products, tags
"""
import json
import sys
import os

# Add parent dir to path so `from ghl import ...` works
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ghl import GHLClient, GHLError


def _snake_to_camel(d):
    """Convert snake_case dict keys to camelCase for GHL API."""
    out = {}
    for k, v in d.items():
        parts = k.split("_")
        out[parts[0] + "".join(p.capitalize() for p in parts[1:])] = v
    return out


def _print(data):
    print(json.dumps(data, indent=2))


def _parse_args():
    args = {}
    i = 3
    while i < len(sys.argv):
        if sys.argv[i].startswith("--"):
            key = sys.argv[i][2:].replace("-", "_")
            if i + 1 < len(sys.argv) and not sys.argv[i + 1].startswith("--"):
                args[key] = sys.argv[i + 1]
                i += 2
            else:
                args[key] = True
                i += 1
        else:
            i += 1
    return args


def _unknown(resource, action):
    print(f"Unknown {resource} action: {action}", file=sys.stderr)
    sys.exit(1)


def cmd_contacts(client, action, args):
    if action == "list":
        _print(client.list_contacts(limit=int(args.get("limit", 20)), query=args.get("query")))
    elif action == "get":
        _print(client.get_contact(args["id"]))
    elif action == "create":
        _print(client.create_contact(
            email=args.get("email"), phone=args.get("phone"),
            first_name=args.get("first_name", args.get("first")),
            last_name=args.get("last_name", args.get("last")),
            name=args.get("name")))
    elif action == "upsert":
        _print(client.upsert_contact(
            email=args.get("email"), phone=args.get("phone"),
            firstName=args.get("first_name", args.get("first")),
            lastName=args.get("last_name", args.get("last"))))
    elif action == "update":
        cid = args.pop("id")
        _print(client.update_contact(cid, **_snake_to_camel(args)))
    elif action == "delete":
        _print(client.delete_contact(args["id"]))
    elif action == "search":
        _print(client.search_contacts(args["query"], int(args.get("limit", 20))))
    elif action == "add-tags":
        _print(client.add_tags(args["id"], args["tags"].split(",")))
    elif action == "remove-tags":
        _print(client.remove_tags(args["id"], args["tags"].split(",")))
    elif action == "notes":
        _print(client.get_notes(args["id"]))
    elif action == "add-note":
        _print(client.create_note(args["id"], args["body"]))
    elif action == "tasks":
        _print(client.get_tasks(args["id"]))
    elif action == "add-task":
        _print(client.create_task(args["id"], args["title"],
                                  due_date=args.get("due_date"), description=args.get("description")))
    elif action == "appointments":
        _print(client.get_contact_appointments(args["id"]))
    elif action == "add-to-workflow":
        _print(client.add_to_workflow(args["id"], args["workflow_id"]))
    elif action == "remove-from-workflow":
        _print(client.remove_from_workflow(args["id"], args["workflow_id"]))
    else:
        _unknown("contacts", action)


def cmd_opportunities(client, action, args):
    if action == "list-pipelines":
        _print(client.list_pipelines())
    elif action == "get-pipeline":
        _print(client.get_pipeline(args["id"]))
    elif action == "create":
        _print(client.create_opportunity(
            pipeline_id=args["pipeline_id"], stage_id=args["stage_id"],
            name=args["name"], contact_id=args.get("contact_id"),
            monetary_value=float(args["value"]) if "value" in args else None))
    elif action == "get":
        _print(client.get_opportunity(args["id"]))
    elif action == "update":
        oid = args.pop("id")
        _print(client.update_opportunity(oid, **_snake_to_camel(args)))
    elif action == "delete":
        _print(client.delete_opportunity(args["id"]))
    elif action == "update-status":
        _print(client.update_opportunity_status(args["id"], args["status"]))
    elif action == "search":
        _print(client.search_opportunities(
            pipeline_id=args.get("pipeline_id"), stage_id=args.get("stage_id"),
            query=args.get("query"), limit=int(args.get("limit", 20))))
    else:
        _unknown("opportunities", action)


def cmd_conversations(client, action, args):
    if action == "create":
        _print(client.create_conversation(args["contact_id"]))
    elif action == "get":
        _print(client.get_conversation(args["id"]))
    elif action == "search":
        _print(client.search_conversations(query=args.get("query"), limit=int(args.get("limit", 20))))
    elif action == "messages":
        _print(client.get_messages(args["id"], int(args.get("limit", 20))))
    elif action == "send":
        _print(client.send_message(
            conversation_id=args.get("id"), message_type=args.get("type", "SMS"),
            message=args["message"], contact_id=args.get("contact_id")))
    elif action == "recordings":
        _print(client.get_call_recordings(args["conversation_id"], args["message_id"]))
    else:
        _unknown("conversations", action)


def cmd_calendars(client, action, args):
    if action == "list":
        _print(client.list_calendars())
    elif action == "create":
        _print(client.create_calendar(**{k: v for k, v in args.items()}))
    elif action == "get":
        _print(client.get_calendar(args["id"]))
    elif action == "free-slots":
        _print(client.get_free_slots(args["id"], args["start"], args["end"], args.get("timezone")))
    elif action == "book":
        _print(client.create_appointment(
            calendar_id=args["calendar_id"], contact_id=args["contact_id"],
            start_time=args["start"], end_time=args["end"], title=args.get("title")))
    elif action == "events":
        _print(client.list_events())
    elif action == "get-event":
        _print(client.get_event(args["id"]))
    elif action == "groups":
        _print(client.list_calendar_groups())
    else:
        _unknown("calendars", action)


def cmd_invoices(client, action, args):
    if action == "list":
        _print(client.list_invoices(limit=int(args.get("limit", 20))))
    elif action == "create":
        _print(client.create_invoice(**{k: v for k, v in args.items()}))
    elif action == "get":
        _print(client.get_invoice(args["id"]))
    elif action == "send":
        _print(client.send_invoice(args["id"]))
    elif action == "void":
        _print(client.void_invoice(args["id"]))
    elif action == "templates":
        _print(client.list_invoice_templates())
    elif action == "schedules":
        _print(client.list_invoice_schedules())
    elif action == "estimates":
        _print(client.list_estimates())
    elif action == "generate-number":
        _print(client.generate_invoice_number())
    else:
        _unknown("invoices", action)


def cmd_payments(client, action, args):
    if action == "orders":
        _print(client.list_orders())
    elif action == "get-order":
        _print(client.get_order(args["id"]))
    elif action == "transactions":
        _print(client.list_transactions())
    elif action == "get-transaction":
        _print(client.get_transaction(args["id"]))
    elif action == "subscriptions":
        _print(client.list_subscriptions())
    elif action == "get-subscription":
        _print(client.get_subscription(args["id"]))
    elif action == "coupons":
        _print(client.list_coupons())
    elif action == "create-coupon":
        _print(client.create_coupon(**{k: v for k, v in args.items()}))
    elif action == "providers":
        _print(client.list_payment_providers())
    else:
        _unknown("payments", action)


def cmd_social(client, action, args):
    if action == "list":
        _print(client.list_social_posts())
    elif action == "create":
        _print(client.create_social_post(**{k: v for k, v in args.items()}))
    elif action == "get":
        _print(client.get_social_post(args["id"]))
    elif action == "delete":
        _print(client.delete_social_post(args["id"]))
    elif action == "accounts":
        _print(client.list_social_accounts())
    else:
        _unknown("social", action)


def cmd_media(client, action, args):
    if action == "list":
        _print(client.list_media())
    elif action == "upload":
        _print(client.upload_media(args["file"], name=args.get("name")))
    elif action == "get":
        _print(client.get_media(args["id"]))
    elif action == "delete":
        _print(client.delete_media(args["id"]))
    elif action == "create-folder":
        _print(client.create_media_folder(args["name"]))
    else:
        _unknown("media", action)


def cmd_simple_crud(client, resource, action, args):
    """Generic CRUD for simple resources."""
    method_map = {
        "companies": ("list_companies", "get_company", "create_company", "update_company", "delete_company"),
        "businesses": ("list_businesses", "get_business", "create_business", "update_business", "delete_business"),
        "products": ("list_products", "get_product", "create_product", "update_product", "delete_product"),
        "custom-fields": ("list_custom_fields", "get_custom_field", "create_custom_field", None, "delete_custom_field"),
        "custom-values": ("list_custom_values", "get_custom_value", "create_custom_value", None, "delete_custom_value"),
    }
    list_m, get_m, create_m, update_m, delete_m = method_map.get(resource, (None,) * 5)
    if action == "list" and list_m:
        _print(getattr(client, list_m)())
    elif action == "get" and get_m:
        _print(getattr(client, get_m)(args["id"]))
    elif action == "create" and create_m:
        _print(getattr(client, create_m)(**{k: v for k, v in args.items()}))
    elif action == "update" and update_m:
        oid = args.pop("id")
        _print(getattr(client, update_m)(oid, **_snake_to_camel(args)))
    elif action == "delete" and delete_m:
        _print(getattr(client, delete_m)(args["id"]))
    else:
        _unknown(resource, action)


def cmd_list_only(client, resource, action, args):
    """Resources with list/get only."""
    method_map = {
        "workflows": ("list_workflows", "get_workflow"),
        "funnels": ("list_funnels", "get_funnel"),
        "forms": ("list_forms", None),
        "surveys": ("list_surveys", None),
        "courses": ("list_courses", "get_course"),
        "users": ("list_users", "get_user"),
        "documents": ("list_documents", "get_document"),
    }
    list_m, get_m = method_map.get(resource, (None, None))
    if action == "list" and list_m:
        _print(getattr(client, list_m)())
    elif action == "get" and get_m:
        _print(getattr(client, get_m)(args["id"]))
    elif action == "submissions" and resource == "forms":
        _print(client.get_form_submissions(form_id=args.get("form_id"), limit=int(args.get("limit", 20))))
    elif action == "submissions" and resource == "surveys":
        _print(client.get_survey_submissions(survey_id=args.get("survey_id"), limit=int(args.get("limit", 20))))
    elif action == "enroll" and resource == "courses":
        _print(client.enroll_contact(args["course_id"], args["contact_id"]))
    elif action == "enrollments" and resource == "courses":
        _print(client.list_enrollments(args["course_id"]))
    else:
        _unknown(resource, action)


def cmd_tags(client, action, args):
    if action == "list":
        _print(client.list_location_tags())
    elif action == "create":
        _print(client.create_location_tag(args["name"]))
    elif action == "update":
        _print(client.update_location_tag(args["id"], args["name"]))
    elif action == "delete":
        _print(client.delete_location_tag(args["id"]))
    else:
        _unknown("tags", action)


def cmd_webhooks(client, action, args):
    if action == "list":
        _print(client.list_webhooks())
    elif action == "create":
        events = args["events"].split(",")
        _print(client.create_webhook(args["url"], events))
    elif action == "delete":
        _print(client.delete_webhook(args["id"]))
    else:
        _unknown("webhooks", action)


RESOURCES = [
    "contacts", "opportunities", "conversations", "calendars",
    "invoices", "payments", "social", "media", "companies",
    "custom-fields", "custom-values", "workflows", "funnels",
    "forms", "surveys", "courses", "businesses", "users",
    "documents", "products", "tags", "webhooks",
]


def main():
    if len(sys.argv) < 3:
        print(f"Usage: ghl-api.py <resource> <action> [--param value ...]")
        print(f"Resources: {', '.join(RESOURCES)}")
        sys.exit(1)

    resource = sys.argv[1]
    action = sys.argv[2]
    args = _parse_args()
    client = GHLClient()

    try:
        if resource == "contacts":
            cmd_contacts(client, action, args)
        elif resource == "opportunities":
            cmd_opportunities(client, action, args)
        elif resource == "conversations":
            cmd_conversations(client, action, args)
        elif resource == "calendars":
            cmd_calendars(client, action, args)
        elif resource == "invoices":
            cmd_invoices(client, action, args)
        elif resource == "payments":
            cmd_payments(client, action, args)
        elif resource == "social":
            cmd_social(client, action, args)
        elif resource == "media":
            cmd_media(client, action, args)
        elif resource == "tags":
            cmd_tags(client, action, args)
        elif resource == "webhooks":
            cmd_webhooks(client, action, args)
        elif resource in ("companies", "businesses", "products", "custom-fields", "custom-values"):
            cmd_simple_crud(client, resource, action, args)
        elif resource in ("workflows", "funnels", "forms", "surveys", "courses", "users", "documents"):
            cmd_list_only(client, resource, action, args)
        else:
            print(f"Unknown resource: {resource}. Available: {', '.join(RESOURCES)}", file=sys.stderr)
            sys.exit(1)
    except GHLError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    except KeyError as e:
        print(f"Missing required parameter: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
