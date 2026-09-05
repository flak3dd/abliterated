FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY serve-openai-bridge.py .
ENV ABLITERATED_IMAGE_HOST=0.0.0.0
ENV ABLITERATED_IMAGE_PORT=7860
EXPOSE 7860
CMD ["python", "serve-openai-bridge.py"]
