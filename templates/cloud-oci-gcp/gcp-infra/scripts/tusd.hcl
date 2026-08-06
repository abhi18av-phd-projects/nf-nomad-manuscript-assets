job "tusd" {
  datacenters = ["dc1"]
  type        = "service"

  group "tusd" {
    count = 1

    # Keep tusd on client-0 to match the bastion Caddy upstream hostname.
    constraint {
      attribute = "${node.unique.name}"
      operator  = "regexp"
      value     = ".*-nomad-client-0(\\..*)?$"
    }

    network {
      port "http" {
        static = 1080
        to     = 8080
      }
      port "hook" {
        to = 8090
      }
    }

    task "tusd" {
      driver = "docker"

      env {
        AWS_ACCESS_KEY_ID     = "${minioAccessKey}"
        AWS_SECRET_ACCESS_KEY = "${minioSecretKey}"
        AWS_REGION            = "us-east-1"
      }

      config {
        image = "tusproject/tusd:v2"
        args  = [
          "-s3-bucket=user-input",
          "-s3-endpoint=http://${minioEndpoint}",
          "-max-size=${tusdMaxSize}",
          "-behind-proxy",
          "-hooks-http=http://${NOMAD_ADDR_hook}/hook",
          "-hooks-enabled-events=post-finish",
        ]
        ports = ["http"]
      }

      resources {
        cpu    = 200
        memory = 256
      }

      service {
        name     = "tusd"
        port     = "http"
        provider = "nomad"

        check {
          type     = "tcp"
          interval = "10s"
          timeout  = "3s"
        }
      }
    }

      # Hook worker: when tusd finishes an upload, rename object key to original filename metadata.
      task "rename-hook" {
        driver = "docker"

        env {
        AWS_ACCESS_KEY_ID     = "${minioAccessKey}"
        AWS_SECRET_ACCESS_KEY = "${minioSecretKey}"
        AWS_REGION            = "us-east-1"
        AWS_EC2_METADATA_DISABLED = "true"
        MINIO_ENDPOINT        = "http://${minioEndpoint}"
        MINIO_BUCKET          = "user-input"
        }

        config {
        image      = "python:3.12-alpine"
        command    = "sh"
        args       = ["-c", "pip install --no-cache-dir boto3 && python /local/hook_server.py"]
        ports      = ["hook"]
        }

        template {
        destination = "local/hook_server.py"
          data = <<PY
import json
import logging
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

ENDPOINT = os.environ.get("MINIO_ENDPOINT", "http://127.0.0.1:9000")
BUCKET = os.environ.get("MINIO_BUCKET", "user-input")

s3 = boto3.client(
  "s3",
  endpoint_url=ENDPOINT,
  aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
  aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
  region_name=os.environ.get("AWS_REGION", "us-east-1"),
  config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
)


def exists(bucket, key):
  try:
    s3.head_object(Bucket=bucket, Key=key)
    return True
  except ClientError as err:
    code = err.response.get("Error", {}).get("Code", "")
    if code in {"404", "NoSuchKey", "NotFound"}:
      return False
    raise


def first_nonempty(*values):
  for value in values:
    if isinstance(value, str) and value:
      return value
  return ""


def compute_source_key(upload):
  storage = upload.get("Storage") or upload.get("storage") or {}
  s3_storage = storage.get("S3") or storage.get("s3") or {}
  upload_id = first_nonempty(upload.get("ID"), upload.get("id"))
  if upload_id and "+" in upload_id:
    upload_id = upload_id.split("+", 1)[0]
  return first_nonempty(
    s3_storage.get("Key"),
    s3_storage.get("ObjectKey"),
    s3_storage.get("object_key"),
    s3_storage.get("Object"),
    upload_id,
  )


def rename_from_payload(payload):
  event = payload.get("Event") or payload.get("event") or {}
  upload = event.get("Upload") or event.get("upload") or {}
  meta = upload.get("MetaData") or upload.get("metadata") or {}

  # Use the name metadata as-is; sanitization is expected from abc CLI.
  desired_name = first_nonempty(meta.get("filename"), meta.get("name"))
  if not desired_name:
    logging.info("hook: metadata has no name/filename; skipping")
    return

  source_key = compute_source_key(upload)
  if not source_key:
    logging.info("hook: missing source object key; skipping")
    return

  if source_key == desired_name:
    logging.info("hook: source key already equals desired name: %s", source_key)
    return

  target_key = desired_name
  source_info_key = f"{source_key}.info"
  target_info_key = f"{target_key}.info"

  if exists(BUCKET, target_key) or exists(BUCKET, target_info_key):
    stem, dot, ext = desired_name.partition(".")
    suffix = source_key[:8] if source_key else "upload"
    target_key = f"{stem}__{suffix}{dot}{ext}" if dot else f"{stem}__{suffix}"
    target_info_key = f"{target_key}.info"

  logging.info("hook: renaming s3://%s/%s -> s3://%s/%s", BUCKET, source_key, BUCKET, target_key)
  s3.copy_object(
    Bucket=BUCKET,
    Key=target_key,
    CopySource={"Bucket": BUCKET, "Key": source_key},
    MetadataDirective="COPY",
  )
  s3.delete_object(Bucket=BUCKET, Key=source_key)

  if exists(BUCKET, source_info_key):
    logging.info("hook: renaming s3://%s/%s -> s3://%s/%s", BUCKET, source_info_key, BUCKET, target_info_key)
    s3.copy_object(
      Bucket=BUCKET,
      Key=target_info_key,
      CopySource={"Bucket": BUCKET, "Key": source_info_key},
      MetadataDirective="COPY",
    )
    s3.delete_object(Bucket=BUCKET, Key=source_info_key)


class Handler(BaseHTTPRequestHandler):
  def do_POST(self):
    if self.path != "/hook":
      self.send_response(404)
      self.end_headers()
      return
    try:
      length = int(self.headers.get("Content-Length", "0"))
      body = self.rfile.read(length) if length > 0 else b"{}"
      payload = json.loads(body.decode("utf-8"))
      rename_from_payload(payload)
      self.send_response(200)
      self.send_header("Content-Type", "application/json")
      self.end_headers()
      self.wfile.write(b"{}")
    except Exception:
      logging.exception("hook: failed processing callback")
      # Do not fail upload completion because of rename hook errors.
      self.send_response(200)
      self.send_header("Content-Type", "application/json")
      self.end_headers()
      self.wfile.write(b"{}")

  def log_message(self, fmt, *args):
    logging.info("http: " + fmt, *args)


if __name__ == "__main__":
  server = HTTPServer(("0.0.0.0", 8090), Handler)
  logging.info("hook: listening on 0.0.0.0:8090")
  server.serve_forever()
PY
        }

        resources {
        cpu    = 150
        memory = 192
        }
      }
  }
}
