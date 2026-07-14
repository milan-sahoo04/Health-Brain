import random
import networkx as nx
from gensim.models import Word2Vec
from .models import GraphNode, GraphEdge

def build_graph(nodes: list[GraphNode], edges: list[GraphEdge]) -> nx.Graph:
    g = nx.Graph()
    for n in nodes:
        g.add_node(n.id)
    for e in edges:
        g.add_edge(e.source, e.target)
    return g

def generate_walks(g: nx.Graph, num_walks: int, walk_length: int) -> list[list[str]]:
    """Unweighted random walks. O(V * num_walks * walk_length) — linear in
    graph size, appropriate for per-patient (not global) graphs."""
    walks = []
    nodes = list(g.nodes())
    for _ in range(num_walks):
        random.shuffle(nodes)
        for start in nodes:
            walk = [start]
            current = start
            for _ in range(walk_length - 1):
                neighbors = list(g.neighbors(current))
                if not neighbors:
                    break
                current = random.choice(neighbors)
                walk.append(current)
            walks.append(walk)
    return walks

def compute_embeddings(
    nodes: list[GraphNode],
    edges: list[GraphEdge],
    dimensions: int = 64,
    walk_length: int = 20,
    num_walks: int = 10,
) -> dict[str, list[float]]:
    g = build_graph(nodes, edges)
    if g.number_of_nodes() == 0:
        return {}

    walks = generate_walks(g, num_walks, walk_length)
    walks_str = [[str(n) for n in w] for w in walks]

    model = Word2Vec(
        sentences=walks_str,
        vector_size=dimensions,
        window=5,
        min_count=0,
        sg=1,        # skip-gram — standard for Node2Vec-style embeddings
        workers=4,
        epochs=5,
    )

    return {
        node_id: model.wv[node_id].tolist()
        for node_id in g.nodes()
        if node_id in model.wv
    }