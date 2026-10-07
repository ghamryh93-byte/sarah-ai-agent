import type { IncomingMessage, ServerResponse } from "http"
import { handleRequest } from "../src/index"

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  return handleRequest(req, res)
}
