import type { FastifyInstance } from "fastify";
import { pool } from "../services/db.js";

interface PostBody {
  title?: string;
  content?: string;
  outline?: string;
  style?: string;
  tone?: string;
}

export async function postRoutes(app: FastifyInstance): Promise<void> {
  // List all posts
  app.get("/posts", async (_request, reply) => {
    const result = await pool.query(
      "SELECT id, title, outline, style, tone, created_at, updated_at FROM posts ORDER BY updated_at DESC"
    );
    return reply.send(result.rows);
  });

  // Get single post
  app.get<{ Params: { id: string } }>("/posts/:id", async (request, reply) => {
    const { id } = request.params;
    const result = await pool.query("SELECT * FROM posts WHERE id = $1", [id]);
    if (result.rowCount === 0) {
      return reply.status(404).send({ error: "Post not found" });
    }
    return reply.send(result.rows[0]);
  });

  // Create post
  app.post<{ Body: PostBody }>("/posts", async (request, reply) => {
    const { title = "", content = "", outline = "", style = "", tone = "" } =
      request.body ?? {};
    const result = await pool.query(
      `INSERT INTO posts (title, content, outline, style, tone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [title, content, outline, style, tone]
    );
    return reply.status(201).send(result.rows[0]);
  });

  // Update post
  app.put<{ Params: { id: string }; Body: PostBody }>(
    "/posts/:id",
    async (request, reply) => {
      const { id } = request.params;
      const { title, content, outline, style, tone } = request.body ?? {};

      const result = await pool.query(
        `UPDATE posts
         SET
           title = COALESCE($1, title),
           content = COALESCE($2, content),
           outline = COALESCE($3, outline),
           style = COALESCE($4, style),
           tone = COALESCE($5, tone),
           updated_at = NOW()
         WHERE id = $6
         RETURNING *`,
        [title, content, outline, style, tone, id]
      );

      if (result.rowCount === 0) {
        return reply.status(404).send({ error: "Post not found" });
      }
      return reply.send(result.rows[0]);
    }
  );

  // Delete post
  app.delete<{ Params: { id: string } }>(
    "/posts/:id",
    async (request, reply) => {
      const { id } = request.params;
      const result = await pool.query(
        "DELETE FROM posts WHERE id = $1 RETURNING id",
        [id]
      );
      if (result.rowCount === 0) {
        return reply.status(404).send({ error: "Post not found" });
      }
      return reply.status(204).send();
    }
  );
}
