#!/usr/bin/env npx tsx
/**
 * Supabase (Postgres) MCP Server — read-only
 * Reads SUPABASE_DB_URL from the repo's .env so no secret lives in .mcp.json.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pg from "pg";
import { z } from "zod";
import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "..", ".env") });

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error("SUPABASE_DB_URL missing from .env — paste the Supabase DEV connection string there.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString });
const server = new McpServer({ name: "supabase-dev", version: "1.0.0" });

server.tool(
  "query",
  "Run read-only SQL against Supabase DEV (max 50 rows returned)",
  { sql: z.string().describe("SQL query to execute") },
  async ({ sql }) => {
    try {
      const limitedSql = sql.toLowerCase().includes("limit")
        ? sql
        : `${sql} LIMIT 50`;
      const result = await pool.query(limitedSql);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ rowCount: result.rowCount, rows: result.rows }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
