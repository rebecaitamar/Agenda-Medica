/**
 * DOBLE DE PRUEBA (solo tests E2E): implementa el subconjunto de la API de
 * Supabase Auth (GoTrue) que usa @supabase/ssr — iniciar sesión con contraseña,
 * renovar sesión, obtener usuario y cerrar sesión — para ejecutar el panel de
 * punta a punta sin un proyecto de Supabase. En producción se usa Supabase Auth.
 */
import { createHmac, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

type User = { id: string; email: string; password: string };

function b64(o: unknown) {
  return Buffer.from(JSON.stringify(o)).toString("base64url");
}

export class AuthStub {
  users: User[] = [];
  private tokens = new Map<string, string>(); // access/refresh token → user id
  private server: Server | null = null;
  port = 0;

  addUser(email: string, password: string, id: string = randomUUID()) {
    this.users.push({ id, email, password });
    return id;
  }

  private jwt(user: User) {
    const now = Math.floor(Date.now() / 1000);
    const head = b64({ alg: "HS256", typ: "JWT" });
    const body = b64({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600, session_id: randomUUID() });
    const sig = createHmac("sha256", "stub").update(`${head}.${body}`).digest("base64url");
    return `${head}.${body}.${sig}`;
  }

  private userJson(u: User) {
    const t = new Date().toISOString();
    return { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: t, created_at: t, updated_at: t, app_metadata: { provider: "email" }, user_metadata: {}, identities: [] };
  }

  private session(u: User) {
    const access = this.jwt(u);
    const refresh = randomUUID();
    this.tokens.set(access, u.id);
    this.tokens.set(`r:${refresh}`, u.id);
    return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: refresh, user: this.userJson(u) };
  }

  async start(port = 0) {
    this.server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const url = new URL(req.url ?? "/", "http://x");
        const send = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
        const body = raw ? JSON.parse(raw) : {};
        const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
        if (url.pathname === "/auth/v1/token" && req.method === "POST") {
          const grant = url.searchParams.get("grant_type");
          if (grant === "password") {
            const u = this.users.find((x) => x.email === body.email && x.password === body.password);
            return u ? send(200, this.session(u)) : send(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
          }
          if (grant === "refresh_token") {
            const id = this.tokens.get(`r:${body.refresh_token}`);
            const u = this.users.find((x) => x.id === id);
            return u ? send(200, this.session(u)) : send(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
          }
        }
        if (url.pathname === "/auth/v1/user" && req.method === "GET") {
          const id = this.tokens.get(bearer);
          const u = this.users.find((x) => x.id === id);
          return u ? send(200, this.userJson(u)) : send(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
        }
        if (url.pathname === "/auth/v1/logout") {
          this.tokens.delete(bearer);
          return res.writeHead(204).end();
        }
        if (url.pathname === "/auth/v1/recover") return send(200, {});
        send(404, { msg: "not implemented in stub" });
      });
    });
    await new Promise<void>((r) => this.server!.listen(port, "127.0.0.1", () => r()));
    this.port = (this.server!.address() as { port: number }).port;
    return this;
  }

  async stop() {
    await new Promise<void>((r) => this.server?.close(() => r()));
  }
}
