import { Tx, emptySnapshot, type Ctx, type Snapshot } from '../core/index.ts'

export function makeCtx(start = 1_000): Ctx & { tick: () => void } {
  let n = 0
  const ctx = {
    now: start,
    newId: () => `id${++n}`,
    tick: () => {
      ctx.now += 1
    },
  }
  return ctx
}

/** 在快照上执行一次事务，返回新快照与变更。 */
export function run<T>(snap: Snapshot, ctx: Ctx, fn: (tx: Tx) => T): { snap: Snapshot; out: T; tx: Tx } {
  const tx = new Tx(snap, ctx)
  const out = fn(tx)
  return { snap: tx.snap, out, tx }
}

export { emptySnapshot }
