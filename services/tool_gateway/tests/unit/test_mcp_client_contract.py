"""Contract between the gateway service, the MCP client and the MCP server.

Regressions covered: the Phase 0 restructure deleted the MCP server module the
client launches, and the client never had a delete_field method, so every
Salesforce call (and every Tier-3 deletion) failed at runtime.
"""

import importlib
import inspect
import re

from tool_gateway.api import service as service_module
from tool_gateway.salesforce.mcp_client import SalesforceMCPClient


def test_every_salesforce_call_in_the_service_exists_on_the_mcp_client():
    source = inspect.getsource(service_module)
    called = set(re.findall(r"self\.salesforce\.([a-z_]+)\(", source))
    missing = sorted(name for name in called if not hasattr(SalesforceMCPClient, name))
    assert not missing, f"SalesforceMCPClient is missing: {missing}"


def test_client_launches_an_importable_server_module():
    transport = SalesforceMCPClient()._create_transport()
    args = list(transport.args)
    module_name = args[args.index("-m") + 1]
    module = importlib.import_module(module_name)
    assert hasattr(module, "mcp"), f"{module_name} does not define the FastMCP server"


def test_child_process_receives_the_gateway_environment():
    # Without this the child loses PYTHONPATH and the SF_* credentials.
    transport = SalesforceMCPClient()._create_transport()
    assert transport.env and "PATH" in transport.env


def test_server_exposes_every_tool_the_client_calls():
    client_source = inspect.getsource(SalesforceMCPClient)
    tools_called = set(re.findall(r'"(salesforce_[a-z_]+)"', client_source))
    server_source = inspect.getsource(importlib.import_module("tool_gateway.salesforce.server"))
    tools_defined = set(re.findall(r"@mcp\.tool\(\)\s*\ndef (salesforce_[a-z_]+)", server_source))
    assert tools_called <= tools_defined, f"not served: {sorted(tools_called - tools_defined)}"
