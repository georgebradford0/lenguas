FROM python:3.12-slim

# CPU-only torch: the default wheel pulls in CUDA libraries (multiple GB).
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake the model into the image so the container never needs the network.
ENV HF_HOME=/opt/hf
RUN python -c "from transformers import AutoTokenizer, VitsModel; \
AutoTokenizer.from_pretrained('facebook/mms-tts-lat'); VitsModel.from_pretrained('facebook/mms-tts-lat')"
ENV HF_HUB_OFFLINE=1 CACHE_DIR=/cache

WORKDIR /app
COPY app.py .

EXPOSE 8000
# One worker: each would load its own copy of the model.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
