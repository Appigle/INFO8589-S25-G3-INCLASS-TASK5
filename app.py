import os
import logging
from dotenv import load_dotenv
import httpx

from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# ---------- OpenTelemetry (backend) ----------
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.semconv.resource import ResourceAttributes
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor

# ---------- PayPal SDK ----------
from paypalserversdk.http.auth.o_auth_2 import ClientCredentialsAuthCredentials
from paypalserversdk.logging.configuration.api_logging_configuration import (
    LoggingConfiguration, RequestLoggingConfiguration, ResponseLoggingConfiguration
)
from paypalserversdk.paypal_serversdk_client import PaypalServersdkClient
from paypalserversdk.controllers.orders_controller import OrdersController
from paypalserversdk.controllers.payments_controller import PaymentsController
from paypalserversdk.models.amount_with_breakdown import AmountWithBreakdown
from paypalserversdk.models.checkout_payment_intent import CheckoutPaymentIntent
from paypalserversdk.models.order_request import OrderRequest
from paypalserversdk.models.purchase_unit_request import PurchaseUnitRequest

import uvicorn

# ------------------ Env & logging ------------------
load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("app")

PAYPAL_CLIENT_ID = os.getenv("PAYPAL_CLIENT_ID")
PAYPAL_CLIENT_SECRET = os.getenv("PAYPAL_CLIENT_SECRET")

# ------------------ FastAPI app ------------------
app = FastAPI(title="PayPal + React + OTel")

# ------------------ OpenTelemetry setup ------------------
OTLP_TRACES_URL = os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "http://10.172.27.4:4318/v1/traces")

resource = Resource.create({
    ResourceAttributes.SERVICE_NAME: "fastapi-paypal-backend",
    ResourceAttributes.DEPLOYMENT_ENVIRONMENT: "dev",
})

provider = TracerProvider(resource=resource)
processor = BatchSpanProcessor(OTLPSpanExporter(endpoint=OTLP_TRACES_URL))
provider.add_span_processor(processor)
trace.set_tracer_provider(provider)

# Instrument FastAPI and outbound HTTP (requests used by PayPal SDK)
FastAPIInstrumentor.instrument_app(app)
RequestsInstrumentor().instrument()

# ------------------ PayPal client ------------------
paypal_client: PaypalServersdkClient = PaypalServersdkClient(
    client_credentials_auth_credentials=ClientCredentialsAuthCredentials(
        o_auth_client_id=PAYPAL_CLIENT_ID,
        o_auth_client_secret=PAYPAL_CLIENT_SECRET,
    ),
    logging_configuration=LoggingConfiguration(
        log_level=logging.INFO,
        mask_sensitive_headers=False,  # set True in production
        request_logging_config=RequestLoggingConfiguration(log_headers=True, log_body=True),
        response_logging_config=ResponseLoggingConfiguration(log_headers=True, log_body=True),
    ),
)

orders_controller: OrdersController = paypal_client.orders
payments_controller: PaymentsController = paypal_client.payments  # kept for future use
COLLECTOR_TRACES = "http://10.172.27.4:4318/v1/traces"

@app.post("/otel/v1/traces")
async def otel_proxy(request: Request):
    body = await request.body()
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            COLLECTOR_TRACES,
            content=body,
            headers={"Content-Type": "application/json"},
        )
    return Response(
        content=r.content,
        status_code=r.status_code,
        media_type=r.headers.get("content-type", "application/json"),
    )

# ------------------ API endpoints ------------------
@app.get("/clientid")
async def clientid():
    return {"clientid": PAYPAL_CLIENT_ID}

@app.post("/orders")
async def create_order(request: Request):
    # your UI sends a cart; we keep it for future expansion
    _ = await request.json()

    order = orders_controller.orders_create({
        "body": OrderRequest(
            intent=CheckoutPaymentIntent.CAPTURE,
            purchase_units=[
                PurchaseUnitRequest(
                    amount=AmountWithBreakdown(currency_code="USD", value="100")
                )
            ],
        )
    })
    return order.body

@app.post("/capture/{order_id}")
def capture_order(order_id: str):
    order = orders_controller.orders_capture({"id": order_id, "prefer": "return=representation"})
    return order.body

# ------------------ Static frontend (React build) ------------------
DIST_DIR = os.path.join("frontend", "dist")
ASSETS_DIR = os.path.join(DIST_DIR, "assets")
INDEX_FILE = os.path.join(DIST_DIR, "index.html")

if not os.path.exists(INDEX_FILE):
    logger.warning("React build not found at %s. Run `npm run build` in ./frontend", INDEX_FILE)

# Serve /assets/* (generated by Vite)
if os.path.isdir(ASSETS_DIR):
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")

# Root index
@app.get("/")
async def root():
    return FileResponse(INDEX_FILE)

# Optional SPA fallback: serve index.html for non-API GETs
@app.get("/{full_path:path}")
async def spa_fallback(full_path: str, request: Request):
    # Don't catch API/static requests
    if full_path.startswith(("clientid", "orders", "capture", "assets", "favicon.ico")):
        return FileResponse(INDEX_FILE) if full_path == "" else FileResponse(INDEX_FILE)  # or return 404
    return FileResponse(INDEX_FILE)

# ------------------ Entrypoint ------------------
if __name__ == "__main__":
    # Use 0.0.0.0 if running inside a container; otherwise localhost is fine
    uvicorn.run(app, host="0.0.0.0", port=8080)
