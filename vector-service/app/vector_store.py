import threading
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
from .config import settings

COLLECTION_NAME = "wiki_sections"
VECTOR_SIZE = 768  # all-mpnet-base-v2's known output dimension

_client: QdrantClient | None = None
_client_lock = threading.Lock()

def get_client() -> QdrantClient:
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:  # double-checked locking
                _client = QdrantClient(path=settings.QDRANT_LOCAL_PATH)
                _ensure_collection(_client)
    return _client

def _ensure_collection(client: QdrantClient) -> None:
    """Idempotent — safe to call on every startup, same principle as
    ensureKnowledgeSchema/ensureWikiSchema's IF NOT EXISTS constraints."""
    existing = [c.name for c in client.get_collections().collections]
    if COLLECTION_NAME not in existing:
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
        )

def upsert_vector(section_id: str, vector: list[float], payload: dict) -> None:
    client = get_client()
    client.upsert(
        collection_name=COLLECTION_NAME,
        points=[PointStruct(id=_to_point_id(section_id), vector=vector, payload={**payload, "sectionId": section_id})],
    )

def get_stored_checksum(section_id: str) -> str | None:
    client = get_client()
    point_id = _to_point_id(section_id)
    points = client.retrieve(
        collection_name=COLLECTION_NAME,
        ids=[point_id],
        with_payload=True,
    )
    print(f"[DEBUG] get_stored_checksum: section_id={section_id}, point_id={point_id}, points_returned={len(points)}")
    if points:
        print(f"[DEBUG] payload={points[0].payload}")
    if not points:
        return None
    return points[0].payload.get("contentChecksum")

def _to_point_id(section_id: str) -> str:
    """Qdrant point ids must be UUID or unsigned int — WikiSection ids
    are strings like 'wikisection:patient-x:overview', so we hash them
    to a stable UUID rather than changing WikiSection's own id scheme."""
    import uuid
    return str(uuid.uuid5(uuid.NAMESPACE_URL, section_id))

# --- add to existing file ---
def search(query_vector: list[float], patient_id: str, top_k: int = 5) -> list[dict]:
    from qdrant_client.models import Filter, FieldCondition, MatchValue
    client = get_client()
    results = client.query_points(
        collection_name=COLLECTION_NAME,
        query=query_vector,
        query_filter=Filter(must=[FieldCondition(key="patientId", match=MatchValue(value=patient_id))]),
        limit=top_k,
        with_payload=True,
    )
    return [
        {"sectionId": p.payload.get("sectionId"), "score": p.score, "payload": p.payload}
        for p in results.points
    ]