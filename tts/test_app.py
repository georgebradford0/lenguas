"""Service tests against a fake synthesizer (no torch, no model download).

    uv run --no-project --with fastapi --with httpx --with pytest --with numpy \
        --with soundfile --with pydantic pytest tts
"""
import sys
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))
import app as tts  # noqa: E402


class FakeSynth:
    model_id = "fake/model"

    def __init__(self):
        self.calls = 0

    def synthesize(self, text):
        self.calls += 1
        if not any(c.isalpha() for c in text):
            raise tts.NothingToSay(text)
        t = np.arange(16000) / 16000
        return (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), 16000


@pytest.fixture
def setup(tmp_path):
    synth = FakeSynth()
    return synth, TestClient(tts.create_app({"la": synth}, cache_dir=tmp_path))


def test_returns_mp3_bytes(setup):
    _, client = setup
    r = client.post("/synthesize", json={"text": "Deus est."})
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/mpeg"
    # MP3 starts with an ID3 tag or an MPEG frame sync (11 set bits).
    assert r.content[:3] == b"ID3" or (r.content[0] == 0xFF and r.content[1] & 0xE0 == 0xE0)
    assert len(r.content) > 500


def test_same_text_is_synthesized_once_and_returns_identical_audio(setup):
    synth, client = setup
    a = client.post("/synthesize", json={"text": "Deus est."})
    b = client.post("/synthesize", json={"text": "  Deus est.  "})  # trimmed -> same key
    assert synth.calls == 1
    assert a.content == b.content


def test_different_text_is_a_different_clip(setup):
    synth, client = setup
    client.post("/synthesize", json={"text": "Deus est."})
    client.post("/synthesize", json={"text": "Homo est."})
    assert synth.calls == 2


def test_validation(setup):
    _, client = setup
    assert client.post("/synthesize", json={"text": "  "}).status_code == 400
    assert client.post("/synthesize", json={"text": "x", "language": "xx"}).status_code == 400
    assert client.post("/synthesize", json={"text": "a" * (tts.MAX_CHARS + 1)}).status_code == 413
    assert client.post("/synthesize", json={}).status_code == 422


def test_unspeakable_text_is_422_and_not_cached(setup, tmp_path):
    synth, client = setup
    assert client.post("/synthesize", json={"text": "..."}).status_code == 422
    assert not list(Path(tmp_path).glob("*.mp3"))


def test_health_lists_languages(setup):
    _, client = setup
    assert client.get("/health").json() == {"status": "ok", "languages": ["la"]}
