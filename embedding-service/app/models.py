from pydantic import BaseModel
from typing import Optional

class GraphNode(BaseModel):
    id: str
    labels: list[str]
    type: Optional[str] = None
    date: Optional[str] = None

class GraphEdge(BaseModel):
    source: str
    target: str
    relType: str

class EmbedRequest(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    dimensions: int = 64
    walk_length: int = 20
    num_walks: int = 10

class EmbedResponse(BaseModel):
    embeddings: dict[str, list[float]]
    dimensions: int