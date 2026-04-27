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
