"""
M8.1 scope: model LOADING only. The actual embed() method is M8.2's
deliverable — deliberately not implemented here, per the approved
milestone boundary. This file exists now so main.py has something real
to report model-load status from in /health, without pulling forward
any embedding logic.
"""
from sentence_transformers import SentenceTransformer
from .config import settings

_model: SentenceTransformer | None = None

def load_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer(settings.EMBEDDING_MODEL_NAME)
    return _model

def is_model_loaded() -> bool:
    return _model is not None


# --- add to existing file ---
def embed_text(text: str) -> list[float]:
    """
    M8.2 scope: single-text embedding. Batch embedding (a real
    performance concern once M8.7's full-cohort run happens) is a
    documented future optimization, not built now — this project's
    established discipline is to build the minimal correct thing first
    and batch only once real volume justifies it (same reasoning as
    M6.4 being deferred until M5.6 produced real evidence of the need).
    """
    model = load_model()
    vector = model.encode(text, convert_to_numpy=True)
    return vector.tolist()