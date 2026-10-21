/** FNV-1a hash of the worktree root → stable dev port in 3100..3999. */
export function devServerPort(worktreeRoot: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < worktreeRoot.length; i++) {
        hash ^= worktreeRoot.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return 3100 + (hash % 900);
}
