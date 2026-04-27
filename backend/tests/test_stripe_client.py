import os
from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

import pytest
from unittest.mock import MagicMock, patch

def test_create_checkout_session_returns_url(mocker):
    mock_stripe = mocker.patch("stripe_client.stripe")
    mock_stripe.checkout.Session.create.return_value = MagicMock(url="https://checkout.stripe.com/pay/cs_test_abc")
    from stripe_client import create_checkout_session
    url = create_checkout_session(
        user_id="u1",
        user_email="user@example.com",
        success_url="https://veris.news?upgraded=1",
        cancel_url="https://veris.news"
    )
    assert url == "https://checkout.stripe.com/pay/cs_test_abc"

def test_cancel_subscription_no_sub_id_does_not_raise(mocker):
    mock_sb = mocker.patch("stripe_client._supabase")
    mock_sb.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = None
    mocker.patch("stripe_client.stripe")
    from stripe_client import cancel_subscription
    cancel_subscription(user_id="u1")  # should not raise

def test_cancel_subscription_cancels_when_sub_exists(mocker):
    mock_sb = mocker.patch("stripe_client._supabase")
    mock_sb.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"stripe_sub_id": "sub_xyz"}
    mock_stripe = mocker.patch("stripe_client.stripe")
    from stripe_client import cancel_subscription
    cancel_subscription(user_id="u1")
    mock_stripe.Subscription.cancel.assert_called_once_with("sub_xyz")
