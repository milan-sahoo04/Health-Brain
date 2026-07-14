from fastapi import FastAPI, HTTPException
from .models import EmbedRequest, EmbedResponse
from .node2vec import compute_embeddings

app = FastAPI(title="PHB Embedding Service")

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest):
    if not req.nodes:
        raise HTTPException(status_code=400, detail="nodes list is empty")

    embeddings = compute_embeddings(
        nodes=req.nodes,
        edges=req.edges,
        dimensions=req.dimensions,
        walk_length=req.walk_length,
        num_walks=req.num_walks,
    )
    return EmbedResponse(embeddings=embeddings, dimensions=req.dimensions)