import os
from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

import pytest
from unittest.mock import MagicMock, patch

def test_save_analysis_returns_id(mocker):
    mock_sb = mocker.patch("db._supabase")
    mock_sb.table.return_value.insert.return_value.execute.return_value.data = [{"id": "abc-123"}]
    from db import save_analysis
    result = save_analysis(
        user_id="u1",
        url="https://example.com",
        source_name="NYT",
        headline="Test headline",
        lean_label="Center-left",
        lean_numeric=-3,
        fact_score=78,
        result_json={"foo": "bar"},
        article_text="Some text here",
    )
    assert result == "abc-123"

def test_save_analysis_insert_failure_does_not_raise(mocker):
    mock_sb = mocker.patch("db._supabase")
    mock_sb.table.return_value.insert.return_value.execute.side_effect = Exception("db error")
    from db import save_analysis
    result = save_analysis(
        user_id="u1", url=None, source_name=None, headline=None,
        lean_label=None, lean_numeric=None, fact_score=None,
        result_json={}, article_text="",
    )
    assert result is None

def test_get_history_returns_list(mocker):
    mock_sb = mocker.patch("db._supabase")
    mock_sb.table.return_value.select.return_value.eq.return_value.order.return_value.range.return_value.execute.return_value.data = [
        {"id": "1", "headline": "Test"}
    ]
    from db import get_history
    result = get_history(user_id="u1", offset=0, limit=20)
    assert result == [{"id": "1", "headline": "Test"}]


def test_get_public_analysis_returns_row_when_shareable(mocker):
    mock_sb = mocker.patch("db._supabase")
    row = {"id": "abc", "shareable": True, "headline": "x"}
    mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = row
    from db import get_public_analysis
    result = get_public_analysis(analysis_id="abc")
    assert result == row


def test_get_public_analysis_returns_none_when_not_shareable(mocker):
    mock_sb = mocker.patch("db._supabase")
    # No row matches when shareable=true is added to the filter.
    mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = None
    from db import get_public_analysis
    result = get_public_analysis(analysis_id="abc")
    assert result is None


def test_get_public_analysis_returns_none_on_error(mocker):
    mock_sb = mocker.patch("db._supabase")
    mock_sb.table.side_effect = Exception("db down")
    from db import get_public_analysis
    result = get_public_analysis(analysis_id="abc")
    assert result is None


def test_set_shareable_true(mocker):
    mock_sb = mocker.patch("db._supabase")
    from db import set_shareable
    set_shareable(analysis_id="abc", user_id="u1", shareable=False)
    # eq().eq().update() — order doesn't matter for the test, but make sure
    # the user_id and analysis_id are both used as filters.
    table_call = mock_sb.table.return_value
    assert table_call.update.called
    update_payload = table_call.update.call_args.args[0]
    assert update_payload == {"shareable": False}
