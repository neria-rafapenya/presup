FROM python:3.13-slim

WORKDIR /app
COPY pyproject.toml README.md ./
COPY services/api ./services/api
RUN pip install --no-cache-dir .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--app-dir", "services/api", "--host", "0.0.0.0", "--port", "8000"]
