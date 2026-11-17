import logging
import uuid
from contextlib import asynccontextmanager
from typing import Dict, Any, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from .service import ToolGatewayService
from tool_gateway.auth import verify_service_key, _verify_grant, MUTATING_TOOLS, _GRANT_HEADER
from tool_gateway.settings import settings

logger = logging.getLogger("tool_gateway.api")


def _safe_error(exc: Exception, *, status: int = 500) -> HTTPException:
    """Log the real exception server-side; return a correlation ID to the caller."""
    correlation_id = uuid.uuid4().hex[:12]
    logger.error("request_error correlation=%s %s: %s", correlation_id, type(exc).__name__, exc)
    return HTTPException(
        status_code=status,
        detail=f"Internal error (ref {correlation_id}). Check server logs for details.",
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Validate required settings on startup; fail fast if secrets are missing."""
    settings.validate_no_defaults()
    logger.info("tool_gateway started env=%s", settings.CDM_ENV)
    yield


app = FastAPI(
    title="CDM-OS Tool Gateway",
    version="1.0.0",
    description="Governed Model Context Protocol (MCP) Tool Gateway for Salesforce and External Systems",
    lifespan=lifespan,
)

gateway = ToolGatewayService()


# ============================================================
# DTO REQUEST MODELS
# ============================================================

class ObjectRequest(BaseModel):
    object_name: str = Field(..., description="Salesforce SObject API name (e.g. Account)")


class FieldRequest(BaseModel):
    object_name: str = Field(..., description="Salesforce SObject API name")
    field_name: str = Field(..., description="Salesforce Field API name")


class DeprecateRequest(BaseModel):
    object_name: str
    field_name: str
    reason: Optional[str] = None


class DeleteFieldRequest(BaseModel):
    object_name: str
    field_name: str
    confirm_delete: bool = Field(
        ...,
        description="Must be true after explicit human approval",
    )
    reason: Optional[str] = None


class RollbackRequest(BaseModel):
    backup_id: str


class BulkScanRequest(BaseModel):
    object_names: Optional[List[str]] = None
    threshold_percentage: Optional[float] = 0.0


class GenericExecuteRequest(BaseModel):
    tool_name: str
    arguments: Dict[str, Any] = Field(default_factory=dict)


# ============================================================
# API ENDPOINTS
# ============================================================

@app.get("/health")
def health():
    """Lightweight liveness probe — never calls Salesforce."""
    return {
        "status": "healthy",
        "gateway": "tool-gateway",
    }


@app.get("/health/salesforce")
async def health_salesforce(_key: str = Depends(verify_service_key)):
    """Deep readiness check — verifies Salesforce connectivity."""
    try:
        result = await gateway.health_check()
        return {
            "status": "healthy",
            "gateway": "tool-gateway",
            "salesforce": result,
        }
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Salesforce unreachable")


@app.get("/tools")
async def tools(_key: str = Depends(verify_service_key)):
    return {
        "tools": await gateway.list_tools()
    }


@app.post("/tools/salesforce/describe-global")
async def describe_global(_key: str = Depends(verify_service_key)):
    try:
        return await gateway.describe_global()
    except Exception as exc:
        raise _safe_error(exc)


@app.post("/tools/salesforce/describe")
async def describe_object(request: ObjectRequest, _key: str = Depends(verify_service_key)):
    try:
        return await gateway.describe_object(request.object_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise _safe_error(exc)


@app.post("/tools/salesforce/field-metadata")
async def field_metadata(request: FieldRequest, _key: str = Depends(verify_service_key)):
    try:
        return await gateway.get_field_metadata(request.object_name, request.field_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise _safe_error(exc)


@app.post("/tools/salesforce/field-usage")
async def field_usage(request: FieldRequest, _key: str = Depends(verify_service_key)):
    try:
        return await gateway.query_field_usage(request.object_name, request.field_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise _safe_error(exc)


@app.post("/tools/salesforce/scan-references")
async def scan_references(request: FieldRequest, _key: str = Depends(verify_service_key)):
    try:
        return await gateway.scan_apex_references(request.object_name, request.field_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise _safe_error(exc)


@app.post("/tools/salesforce/full-assessment")
def full_field_assessment(request: FieldRequest, _key: str = Depends(verify_service_key)):
    try:
        return gateway.full_field_assessment(
            request.object_name,
            request.field_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise _safe_error(exc)


@app.post("/tools/salesforce/backup")
async def backup_field(request: FieldRequest, _key: str = Depends(verify_service_key)):
    try:
        return await gateway.backup_field_definition(request.object_name, request.field_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise _safe_error(exc)


@app.post("/tools/salesforce/deprecate")
async def deprecate_field(
    request: DeprecateRequest,
    raw_request: Request,
    _key: str = Depends(verify_service_key),
):
    grant_header = raw_request.headers.get(_GRANT_HEADER)
    if grant_header:
        _verify_grant(grant_header, request.model_dump(exclude_none=True))
    try:
        return await gateway.deprecate_field(request.object_name, request.field_name, request.reason)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise _safe_error(exc)


@app.post("/tools/salesforce/delete")
async def delete_field(
    request: DeleteFieldRequest,
    raw_request: Request,
    _key: str = Depends(verify_service_key),
):
    grant_header = raw_request.headers.get(_GRANT_HEADER)
    if grant_header:
        _verify_grant(grant_header, request.model_dump(exclude_none=True))
    try:
        return await gateway.delete_field(
            request.object_name,
            request.field_name,
            request.confirm_delete,
            request.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise _safe_error(exc)


@app.post("/tools/salesforce/rollback")
async def rollback_field(
    request: RollbackRequest,
    raw_request: Request,
    _key: str = Depends(verify_service_key),
):
    grant_header = raw_request.headers.get(_GRANT_HEADER)
    if grant_header:
        _verify_grant(grant_header, request.model_dump(exclude_none=True))
    try:
        return await gateway.rollback_field(request.backup_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise _safe_error(exc)


@app.post("/tools/salesforce/bulk-scan")
async def bulk_scan(
    request: BulkScanRequest,
    _key: str = Depends(verify_service_key),
):
    try:
        return await gateway.bulk_scan(request.object_names, request.threshold_percentage or 0.0)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise _safe_error(exc)


@app.post("/tools/execute")
async def execute_tool(
    request: GenericExecuteRequest,
    raw_request: Request,
    _key: str = Depends(verify_service_key),
):
    if request.tool_name in MUTATING_TOOLS:
        grant_header = raw_request.headers.get(_GRANT_HEADER)
        if not grant_header:
            raise HTTPException(
                status_code=403,
                detail=f"Execution grant required for mutating tool '{request.tool_name}'.",
            )
        _verify_grant(grant_header, request.arguments or {})
    try:
        return await gateway.execute_tool(request.tool_name, request.arguments)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise _safe_error(exc)