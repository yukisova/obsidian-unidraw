import type { DocumentSnapshot } from "./document";

/** Snapshot based undo/redo with a bounded stack. */
export class History {
  private undoStack: DocumentSnapshot[] = [];
  private redoStack: DocumentSnapshot[] = [];
  private limit: number;
  private memoryLimit: number;

  constructor(limit = 120, memoryLimit = 200) {
    this.limit = limit;
    this.memoryLimit = memoryLimit;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  push(snapshot: DocumentSnapshot): void {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(current: DocumentSnapshot): DocumentSnapshot | null {
    const previous = this.undoStack.pop();
    if (!previous) return null;
    this.redoStack.push(current);
    if (this.redoStack.length > this.memoryLimit) this.redoStack.shift();
    return previous;
  }

  redo(current: DocumentSnapshot): DocumentSnapshot | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(current);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    return next;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undoDepth(): number {
    return this.undoStack.length;
  }

  redoDepth(): number {
    return this.redoStack.length;
  }
}
