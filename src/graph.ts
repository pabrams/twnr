// create a graph class
export default class Graph {
    noOfVertices: any;
    AdjList: Map<any, any>;
    // defining vertex array and
    // adjacent list
    constructor(noOfVertices: Number)
    {
        this.noOfVertices = noOfVertices;
        this.AdjList = new Map();
    }

    getVertex(v: Number){
        return this.AdjList.get(v);
    }

    // add vertex to the graph
    addVertex(v: Number)
    {
        // initialize the adjacent list with a
        // null array
        this.AdjList.set(v, []);
    }

    // add edge to the graph
    addEdge(v: Number, w: Number)
    {
        // get the list for vertex v and put the
        // vertex w denoting edge between v and w
        this.AdjList.get(v).push(w);

        // Since graph is undirected,
        // add an edge from w to v also
        this.AdjList.get(w).push(v);
    }

    // Prints the vertex and adjacency list
    printGraph()
    {
        // get all the vertices
        var get_keys = this.AdjList.keys();

        // iterate over the vertices
        for (var i of get_keys) 
        {
            // get the corresponding adjacency list
            // for the vertex
            var get_values = this.AdjList.get(i);
            var conc = "";

            // iterate over the adjacency list
            // concatenate the values into a string
            for (var j of get_values)
                conc += j + " ";

            // print the vertex and its adjacency list
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
            
            const visited = new Set<number>(); // To keep track of visited sectors
            const queue: Array<{ sector: number, path: number[] }> = [{ sector: start, path: [start] }]; // Queue to perform BFS

            while (queue.length > 0) {
                const { sector, path } = queue.shift()!;

                if (sector === target) {
                    return path; // If we reach the target, return the path
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

            // If the target is not reachable
            return null;
        } catch (error) {
            console.error('Error finding the shortest path:', error);
            return null;
        }
  }
  


    // dfs(v)
}