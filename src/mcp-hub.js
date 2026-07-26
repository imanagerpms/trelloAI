import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getOctorateAccessToken } from "./octorate-auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

function textFromToolResult(result) {
  if (!result) return null;
  if (typeof result === "string") return result;
  if (Array.isArray(result.content)) {
    return result.content
      .map((c) => {
        if (c.type === "text") return c.text;
        return JSON.stringify(c);
      })
      .join("\n");
  }
  return JSON.stringify(result);
}

export class McpHub {
  constructor() {
    /** @type {Map<string, { client: Client, tools: Array }>} */
    this.servers = new Map();
  }

  async connectAll() {
    await this.connectTrello();
    await this.connectOctorate();
    return this.summary();
  }

  summary() {
    return [...this.servers.entries()].map(([name, s]) => ({
      name,
      tools: s.tools.length,
    }));
  }

  async connectTrello() {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(projectRoot, "src", "server.js")],
      env: {
        ...getDefaultEnvironment(),
        ...Object.fromEntries(
          Object.entries(process.env).filter(([, v]) => v !== undefined)
        ),
      },
      stderr: "pipe",
    });

    transport.stderr?.on("data", (chunk) => {
      const line = chunk.toString().trim();
      if (line) console.error("[mcp:trello]", line);
    });

    const client = new Client({ name: "super-manager-trello", version: "1.0.0" });
    await client.connect(transport);
    const listed = await client.listTools();
    this.servers.set("trello", { client, tools: listed.tools || [] });
    console.log(`MCP trello: ${(listed.tools || []).length} tool`);
  }

  async connectOctorate() {
    if (!process.env.OCTORATE_MCP_SECRET || !process.env.OCTORATE_MCP_PUBLIC) {
      console.warn(
        "OCTORATE_MCP_PUBLIC/SECRET mancanti — Octorate non collegato"
      );
      return;
    }

    let accessToken;
    try {
      accessToken = await getOctorateAccessToken();
    } catch (err) {
      console.error(`[mcp:octorate] ${err.message}`);
      console.warn(
        "Octorate saltato. Sul server apri /oauth/login dopo aver autorizzato il redirect in Octorate."
      );
      return;
    }

    const url = process.env.OCTORATE_MCP_URL || "https://mcp.octorate.com/mcp";
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });

    const client = new Client({
      name: "super-manager-octorate",
      version: "1.0.0",
    });
    await client.connect(transport);
    const listed = await client.listTools();
    this.servers.set("octorate", { client, tools: listed.tools || [] });
    console.log(`MCP octorate: ${(listed.tools || []).length} tool (OAuth)`);
  }

  listServers() {
    return this.summary();
  }

  searchTools(server, query = "", limit = 30) {
    const entry = this.servers.get(server);
    if (!entry) {
      throw new Error(
        `Server MCP sconosciuto: ${server}. Disponibili: ${[...this.servers.keys()].join(", ")}`
      );
    }
    const q = String(query || "").trim().toLowerCase();
    let tools = entry.tools;
    if (q) {
      tools = tools.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.description || "").toLowerCase().includes(q)
      );
    }
    return tools.slice(0, limit).map((t) => ({
      name: t.name,
      description: t.description || "",
      inputSchema: t.inputSchema,
    }));
  }

  getToolSchema(server, toolName) {
    const entry = this.servers.get(server);
    if (!entry) throw new Error(`Server MCP sconosciuto: ${server}`);
    const tool = entry.tools.find((t) => t.name === toolName);
    if (!tool) {
      throw new Error(
        `Tool "${toolName}" non trovato su ${server}. Usa mcp_search_tools.`
      );
    }
    return {
      name: tool.name,
      description: tool.description || "",
      inputSchema: tool.inputSchema,
    };
  }

  async callTool(server, toolName, args = {}) {
    const entry = this.servers.get(server);
    if (!entry) throw new Error(`Server MCP sconosciuto: ${server}`);
    const result = await entry.client.callTool({
      name: toolName,
      arguments: args,
    });
    const text = textFromToolResult(result);
    if (result?.isError) {
      throw new Error(text || `Errore tool ${server}/${toolName}`);
    }
    try {
      return text ? JSON.parse(text) : result;
    } catch {
      return { raw: text };
    }
  }

  async close() {
    for (const [, entry] of this.servers) {
      try {
        await entry.client.close();
      } catch {
        /* ignore */
      }
    }
    this.servers.clear();
  }
}

/** Tool esposti all'LLM (pochi) che instradano verso i server MCP. */
export function buildMcpToolDefinitions() {
  return [
    {
      type: "function",
      function: {
        name: "mcp_list_servers",
        description: "Elenca i server MCP collegati (trello, octorate) e quanti tool hanno",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "mcp_search_tools",
        description:
          "Cerca tool MCP per nome/descrizione. UNA ricerca mirata, poi mcp_call_tool. Non ripetere. Per arrivi usa octorate_arrivi.",
        parameters: {
          type: "object",
          properties: {
            server: { type: "string", description: "trello | octorate" },
            query: {
              type: "string",
              description: "Parola chiave es. reservation, availability, comment, card",
            },
            limit: { type: "number" },
          },
          required: ["server"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "mcp_describe_tool",
        description: "Mostra schema input completo di un tool MCP",
        parameters: {
          type: "object",
          properties: {
            server: { type: "string" },
            tool: { type: "string" },
          },
          required: ["server", "tool"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "mcp_call_tool",
        description:
          "Esegue un tool MCP. Per Trello: server=trello, tool=trello_*. Per Octorate: server=octorate. argumentsJson = JSON degli argomenti.",
        parameters: {
          type: "object",
          properties: {
            server: { type: "string" },
            tool: { type: "string" },
            argumentsJson: {
              type: "string",
              description: 'JSON degli argomenti, es. {"boardId":"..."} oppure {}',
            },
          },
          required: ["server", "tool"],
          additionalProperties: false,
        },
      },
    },
  ];
}

export async function executeMcpTool(hub, name, args = {}) {
  switch (name) {
    case "mcp_list_servers":
      return hub.listServers();
    case "mcp_search_tools":
      return hub.searchTools(args.server, args.query || "", args.limit || 30);
    case "mcp_describe_tool":
      return hub.getToolSchema(args.server, args.tool);
    case "mcp_call_tool": {
      let toolArgs = {};
      if (args.argumentsJson) {
        try {
          toolArgs = JSON.parse(args.argumentsJson);
        } catch {
          throw new Error("argumentsJson non è JSON valido");
        }
      } else if (args.arguments && typeof args.arguments === "object") {
        toolArgs = args.arguments;
      }
      return hub.callTool(args.server, args.tool, toolArgs);
    }
    default:
      throw new Error(`Tool MCP bridge sconosciuto: ${name}`);
  }
}
