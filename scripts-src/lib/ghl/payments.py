"""GHL Payments, Orders, Subscriptions, Transactions, Coupons."""


class PaymentsMixin:

    # ── Orders ──

    def list_orders(self, **params):
        params.setdefault("altId", self.location_id)
        params.setdefault("altType", "location")
        return self._request("GET", "/payments/orders", params=params)

    def get_order(self, order_id):
        return self._request("GET", f"/payments/orders/{order_id}")

    def create_order(self, **fields):
        return self._request("POST", "/payments/orders", fields)

    # ── Fulfillments ──

    def list_fulfillments(self, order_id):
        return self._request("GET", f"/payments/orders/{order_id}/fulfillments")

    def create_fulfillment(self, order_id, **fields):
        return self._request("POST", f"/payments/orders/{order_id}/fulfillments", fields)

    # ── Transactions ──

    def list_transactions(self, **params):
        params.setdefault("altId", self.location_id)
        params.setdefault("altType", "location")
        return self._request("GET", "/payments/transactions", params=params)

    def get_transaction(self, transaction_id):
        return self._request("GET", f"/payments/transactions/{transaction_id}")

    # ── Subscriptions ──

    def list_subscriptions(self, **params):
        params.setdefault("altId", self.location_id)
        params.setdefault("altType", "location")
        return self._request("GET", "/payments/subscriptions", params=params)

    def get_subscription(self, subscription_id):
        return self._request("GET", f"/payments/subscriptions/{subscription_id}")

    # ── Coupons ──

    def list_coupons(self, **params):
        params.setdefault("locationId", self.location_id)
        return self._request("GET", "/payments/coupons", params=params)

    def create_coupon(self, **fields):
        fields.setdefault("locationId", self.location_id)
        return self._request("POST", "/payments/coupons", fields)

    def get_coupon(self, coupon_id):
        return self._request("GET", f"/payments/coupons/{coupon_id}")

    def update_coupon(self, coupon_id, **fields):
        return self._request("PUT", f"/payments/coupons/{coupon_id}", fields)

    def delete_coupon(self, coupon_id):
        return self._request("DELETE", f"/payments/coupons/{coupon_id}")

    # ── Payment Providers ──

    def list_payment_providers(self):
        return self._request("GET", "/payments/integrations/provider/",
                             params={"altId": self.location_id, "altType": "location"})

    def connect_payment_provider(self, **fields):
        return self._request("POST", "/payments/integrations/provider/connect", fields)

    def disconnect_payment_provider(self, **fields):
        return self._request("POST", "/payments/integrations/provider/disconnect", fields)
