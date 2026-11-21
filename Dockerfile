FROM python:3.12-slim
WORKDIR /app
COPY server/requirements.lock /app/server/requirements.lock
RUN pip install --no-cache-dir -r server/requirements.lock && useradd -u 10001 -m popov && mkdir /data && chown popov /data
COPY server /app/server
COPY Исходники /app/Исходники
COPY mobile/docs /app/mobile/docs
RUN python -m server.install_denis
USER popov
EXPOSE 8000
CMD ["uvicorn", "server.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--limit-concurrency", "64", "--proxy-headers"]
