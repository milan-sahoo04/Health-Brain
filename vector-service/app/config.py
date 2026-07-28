"""
Centralized configuration — separated out now (rather than scattering
env reads across files) because M8's migration story (local Qdrant path
-> production cluster URL) explicitly depends on config being the ONLY
thing that changes later, per the approved architecture.
"""
import os

class Settings:
    EMBEDDING_MODEL_NAME: str = os.getenv("EMBEDDING_MODEL_NAME", "sentence-transformers/all-mpnet-base-v2")
    QDRANT_LOCAL_PATH: str = os.getenv("QDRANT_LOCAL_PATH", "./qdrant_data")
    QDRANT_URL: str | None = os.getenv("QDRANT_URL")  # None = use local mode; set later for migration
    EMBEDDING_VERSION: str = os.getenv("EMBEDDING_VERSION", "all-mpnet-base-v2-v1")

settings = Settings()