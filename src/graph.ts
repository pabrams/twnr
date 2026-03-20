
export default class Graph {
    noOfVertices: any;
    AdjList: Map<any, any>;

    constructor(noOfVertices: Number)
    {
        this.noOfVertices = noOfVertices;
        this.AdjList = new Map();
    }

    getVertex(v: Number){
        return this.AdjList.get(v);
    }

    addVertex(v: Number)
    {
        this.AdjList.set(v, []);
    }

    addEdge(v: Number, w: Number)
    {
        this.AdjList.get(v).push(w);
        this.AdjList.get(w).push(v);
    }

    printGraph()
    {
        var get_keys = this.AdjList.keys();
        for (var i of get_keys) 
        {
            var get_values = this.AdjList.get(i);
            var conc = "";

            for (var j of get_values)
                conc += j + " ";

            console.log(i + " -> " + conc);
        }
    }

    // bfs(v)
    // BFS Approach for Shortest Path
    // Graph Representation: The graph is represented as an array of arrays, where each index corresponds to a sector, and the inner array contains the set of adjacent sectors (outgoing warps).
    // BFS Algorithm: We perform BFS from the starting sector to find the shortest path to the target sector.
    // Assuming you have your graph as a Promise<number[][]>
    async getShortestPath(start: number, target: number): Promise<number[] | null> {
        try {
            
            const visited = new Set<number>();
            const queue: Array<{ sector: number, path: number[] }> = [{ sector: start, path: [start] }]; // Queue to perform BFS

            while (queue.length > 0) {
                const { sector, path } = queue.shift()!;

                if (sector === target) {
                    return path;
                }

                if (!visited.has(sector)) {
                    visited.add(sector);

                    // Check all adjacent sectors (warps)
                    for (const neighbor of this.AdjList.get(sector)) {
                        if (!visited.has(neighbor)) {
                            queue.push({ sector: neighbor, path: [...path, neighbor] });
                        }
                    }
                }
            }

            // target is not reachable
            return null;
        } catch (error) {
            console.error('Error finding the shortest path:', error);
            return null;
        }
  }
  


    // dfs(v)
}