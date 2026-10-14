# VideoZombieCouple composer (Cloudflare Container, linux/amd64).
FROM python:3.12-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential && rm -rf /var/lib/apt/lists/*
RUN pip wheel --no-cache-dir --no-deps --wheel-dir /wheels insightface==0.7.3

FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY --from=build /wheels /wheels
RUN pip install --no-cache-dir /wheels/*.whl \
    fastapi==0.115.6 uvicorn==0.34.0 httpx==0.28.1 pillow==11.0.0 "numpy<2.1" \
    opencv-python-headless==4.10.0.84 onnxruntime==1.20.1 && rm -rf /wheels
# Download the face models at build time, never per request.
RUN python -c "from insightface.app import FaceAnalysis; FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider']).prepare(ctx_id=-1)"
WORKDIR /app
COPY fonts ./fonts
COPY app.py caption.py grade.py score.py ./
EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
