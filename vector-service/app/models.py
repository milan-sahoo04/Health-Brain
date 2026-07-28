from pydantic import BaseModel

class HealthResponse(BaseModel):
    status: str
    service: str
    modelLoaded: bool
    modelName: str

# --- add to existing file ---
class EmbedRequest(BaseModel):
    sectionId: str
    content: str
    checksum: str
    lastEmbeddedChecksum: str | None = None  # None = never embedded before

class EmbedResponse(BaseModel):
    sectionId: str
    status: str  # "embedded" | "skipped_unchanged"
    vectorId: str | None = None
    embeddingVersion: str | None = None
    dimensions: int | None = None  

class EmbedRequest(BaseModel):
    sectionId: str
    content: str
    checksum: str
    patientId: str        # NEW
    sectionKey: str         # NEW
    title: str                # NEW
    lastEmbeddedChecksum: str | None = None

# --- add to existing models.py ---
class SearchRequest(BaseModel):
    query: str
    patientId: str
    topK: int = 5

class SearchResultItem(BaseModel):
    sectionId: str
    sectionKey: str | None
    title: str | None
    score: float

class SearchResponse(BaseModel):
    results: list[SearchResultItem]