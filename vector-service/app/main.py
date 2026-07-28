from fastapi import FastAPI
from .models import HealthResponse, EmbedRequest, EmbedResponse, SearchRequest, SearchResultItem, SearchResponse
from .embedder import load_model, is_model_loaded, embed_text
from .config import settings
from .vector_store import upsert_vector, get_stored_checksum, search, get_client
from datetime import datetime, timezone

app = FastAPI(title="PHB Vector Service (M8)")

@app.on_event("startup")
def startup_event():
    load_model()
    get_client()  # force Qdrant client init before requests arrive, avoids race
@app.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(
        status="ok",
        service="vector-service",
        modelLoaded=is_model_loaded(),
        modelName=settings.EMBEDDING_MODEL_NAME,
    )

@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest):
    """
    M8.3: dedup checks REAL Qdrant storage.
    """
    stored_checksum = get_stored_checksum(req.sectionId)
    if stored_checksum == req.checksum:
        return EmbedResponse(sectionId=req.sectionId, status="skipped_unchanged")

    vector = embed_text(req.content)

    upsert_vector(
        section_id=req.sectionId,
        vector=vector,
        payload={
            "patientId": req.patientId,
            "sectionKey": req.sectionKey,
            "title": req.title,
            "contentChecksum": req.checksum,
            "embeddingVersion": settings.EMBEDDING_VERSION,
            "embeddedAt": datetime.now(timezone.utc).isoformat(),
        },
    )

    return EmbedResponse(
        sectionId=req.sectionId, status="embedded", vectorId=req.sectionId,
        embeddingVersion=settings.EMBEDDING_VERSION, dimensions=len(vector),
    )

@app.post("/search", response_model=SearchResponse)
def search_endpoint(req: SearchRequest):
    query_vector = embed_text(req.query)
    raw_results = search(query_vector, patient_id=req.patientId, top_k=req.topK)

    items = [
        SearchResultItem(
            sectionId=r["sectionId"],
            sectionKey=r["payload"].get("sectionKey"),
            title=r["payload"].get("title"),
            score=r["score"],
        )
        for r in raw_results
    ]
    return SearchResponse(results=items)