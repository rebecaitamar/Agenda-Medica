/**
 * DOBLE DE PRUEBA (solo tests): servidor HTTP que imita el endpoint POST /emails
 * de Resend, para verificar qué correos envía la aplicación sin mandar correos
 * reales. Respeta Idempotency-Key como Resend (misma clave → misma respuesta,
 * sin duplicar). En producción la app habla con https://api.resend.com.
 */
import { createServer, type Server } from "node:http";

export type CapturedEmail = { id: string; to: string[]; subject: string; html: string; text: string; idempotencyKey: string | null; at: number };

export class MockResend {
  emails: CapturedEmail[] = [];
  requests = 0;
  /** Cantidad de próximas solicitudes que deben fallar con 500. */
  failNext = 0;
  private byKey = new Map<string, CapturedEmail>();
  private server: Server | null = null;
  port = 0;

  async start(port = 0) {
    this.server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        this.requests++;
        if (req.method !== "POST" || req.url !== "/emails") {
          res.writeHead(404).end();
          return;
        }
        if (req.headers.authorization !== "Bearer re_test_key") {
          res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ name: "validation_error", message: "API key is invalid" }));
          return;
        }
        if (this.failNext > 0) {
          this.failNext--;
          res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ name: "internal_server_error", message: "simulated outage" }));
          return;
        }
        const key = (req.headers["idempotency-key"] as string | undefined) ?? null;
        if (key && this.byKey.has(key)) {
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: this.byKey.get(key)!.id }));
          return;
        }
        const data = JSON.parse(body);
        const email: CapturedEmail = {
          id: `mock_${this.emails.length + 1}`,
          to: data.to,
          subject: data.subject,
          html: data.html,
          text: data.text,
          idempotencyKey: key,
          at: Date.now(),
        };
        this.emails.push(email);
        if (key) this.byKey.set(key, email);
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: email.id }));
      });
    });
    await new Promise<void>((r) => this.server!.listen(port, "127.0.0.1", () => r()));
    this.port = (this.server!.address() as { port: number }).port;
    return this;
  }

  reset() {
    this.emails = [];
    this.requests = 0;
    this.failNext = 0;
    this.byKey.clear();
  }

  to(address: string) {
    return this.emails.filter((e) => e.to.includes(address));
  }

  lastCode(address: string) {
    const m = [...this.to(address)].reverse().find((e) => /código/i.test(e.subject));
    return m?.text.match(/Código: (\d{6})/)?.[1] ?? null;
  }

  async stop() {
    await new Promise<void>((r) => this.server?.close(() => r()));
  }
}
