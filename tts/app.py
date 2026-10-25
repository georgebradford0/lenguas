"""Text-to-speech sidecar for languages AWS Polly has no voice for (Latin).

POST /synthesize {text, language} -> audio/mpeg. The API's /speak route proxies
here. Synthesis is deterministic (fixed seed) so the same text always sounds the
same, which makes the on-disk cache safe: each unique text is synthesized once.
"""
import hashlib
import io
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import soundfile as sf
from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel

# Meta MMS-TTS, one VITS checkpoint per language. CC-BY-NC 4.0 licensed.
MODELS = {"la": "facebook/mms-tts-lat"}

# VITS' duration predictor is stochastic; seeding makes output reproducible.
SEED = 555
MAX_CHARS = 1000
CACHE_DIR = Path(os.environ.get("CACHE_DIR", "/cache"))


class NothingToSay(ValueError):
    """The text has no characters the model can speak (e.g. only punctuation)."""


class VitsSynthesizer:
    """facebook/mms-tts-* via transformers. Heavy imports stay inside load()."""

    def __init__(self, model_id: str):
        self.model_id = model_id
        self._model = None
        self._tokenizer = None
        self._lock = threading.Lock()

    def load(self) -> None:
        import torch
        from transformers import AutoTokenizer, VitsModel

        torch.set_num_threads(int(os.environ.get("TTS_THREADS", "2")))
        self._tokenizer = AutoTokenizer.from_pretrained(self.model_id)
        self._model = VitsModel.from_pretrained(self.model_id).eval()

    def synthesize(self, text: str):
        """Returns (float32 mono samples, sample rate)."""
        import torch

        if self._model is None:
            self.load()
        inputs = self._tokenizer(text, return_tensors="pt")
        if inputs["input_ids"].numel() == 0:
            raise NothingToSay(text)
        # One generation at a time: the model is not thread-safe once seeded,
        # and two CPU cores don't benefit from running two at once.
        with self._lock, torch.inference_mode():
            torch.manual_seed(SEED)
            wave = self._model(**inputs).waveform
        return wave.squeeze().cpu().numpy(), int(self._model.config.sampling_rate)


def encode_mp3(samples, rate: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, samples, rate, format="MP3")
    return buf.getvalue()


class SynthesizeRequest(BaseModel):
    text: str
    language: str = "la"


def create_app(synths: dict, cache_dir: Path = CACHE_DIR, preload: bool = False) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app):
        if preload:
            for s in synths.values():
                s.load()
        yield

    app = FastAPI(lifespan=lifespan)

    @app.get("/health")
    def health():
        return {"status": "ok", "languages": sorted(synths)}

    @app.post("/synthesize")
    def synthesize(req: SynthesizeRequest):
        synth = synths.get(req.language)
        if synth is None:
            raise HTTPException(400, f"unsupported language: {req.language}")
        text = req.text.strip()
        if not text:
            raise HTTPException(400, "text is required")
        if len(text) > MAX_CHARS:
            raise HTTPException(413, f"text is over {MAX_CHARS} characters")

        key = hashlib.sha256(f"{synth.model_id}|{SEED}|{text}".encode()).hexdigest()
        path = cache_dir / f"{key}.mp3"
        if path.exists():
            return Response(path.read_bytes(), media_type="audio/mpeg")

        try:
            samples, rate = synth.synthesize(text)
        except NothingToSay:
            raise HTTPException(422, "text has nothing speakable")
        audio = encode_mp3(samples, rate)

        # Atomic write so a crash mid-write never leaves a truncated clip.
        cache_dir.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
        tmp.write_bytes(audio)
        tmp.replace(path)
        return Response(audio, media_type="audio/mpeg")

    return app


app = create_app({lang: VitsSynthesizer(model) for lang, model in MODELS.items()}, preload=True)
