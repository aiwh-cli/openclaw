-- Search knowledge base by embedding with agent filtering
-- Returns top N results filtered by status, target_agents, and expiration
CREATE OR REPLACE FUNCTION search_knowledge(
  query_embedding vector(1536),
  agent_name text,
  match_count int DEFAULT 3
)
RETURNS TABLE (
  id uuid,
  content text,
  category text,
  similarity float8
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    bk.id,
    bk.content,
    bk.category,
    1 - (bk.embedding <=> query_embedding) AS similarity
  FROM base_knowledge bk
  WHERE bk.status = 'published'
    AND (bk.target_agents @> ARRAY[agent_name] OR bk.target_agents @> ARRAY['all'])
    AND (bk.expires_at IS NULL OR bk.expires_at > now())
  ORDER BY similarity DESC
  LIMIT match_count;
$$;
